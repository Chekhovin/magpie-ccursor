import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { runInNewContext } from 'node:vm'
import { isInjectPatched, isLocalLoopCompatible } from '../vendor/installer/patch-inject.js'
import { patchLocalLoopGate, patchLocalLoopHook } from '../vendor/installer/patch-local-loop.js'

const gate = 'readLocalLoopGate(){return this.experimentService.checkFeatureGate("agent_host_local_loop",{disableExposureLog:!0})}'
const state = 'globalThis.__magpieCcursorConnectMode'
const guard = `${state}===true?false:`
const update = `${state}=newPaths.indexOf("/auth/poll")!==-1;`
const transport = '// callback-client.js\nfunction dispatch(service,transport){return [service.Unary,service.ServerStreaming,service.BiDiStreaming,transport]}\nfunction client(service,transport){return dispatch(service,transport)}'
// Extracted from Cursor 3.26.13: the method bodies are unchanged, including minified identifiers.
const methods = {
  desktop: `stampIdeClientCapabilities(e){const t=this.readLocalLoopGate();return hrp(e,{isRunningInTest:e.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localLoopGateEnabled:t,agentReplaceGraymatter:this.readAgentReplaceGraymatter(t)})}${gate}readAgentReplaceGraymatter(e){return e?this.experimentService.checkFeatureGate("agent_replace_graymatter",{disableExposureLog:!1}):!1}`,
  glass: `stampIdeClientCapabilities(t){const e=this.readLocalLoopGate();return Weg(t,{isRunningInTest:t.isRunningInTest??this.environmentService.enableSmokeTestDriver===!0,localLoopGateEnabled:e,agentReplaceGraymatter:this.readAgentReplaceGraymatter(e)})}${gate}readAgentReplaceGraymatter(t){return t?this.experimentService.checkFeatureGate("agent_replace_graymatter",{disableExposureLog:!1}):!1}`,
}
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(sources: { desktop: string; glass: string }, on = true) {
  const root = mkdtempSync(join(process.cwd(), '.local-loop-test-'))
  roots.push(root)
  const appRoot = join(root, 'cursor'), out = join(appRoot, 'out')
  mkdirSync(out, { recursive: true })
  const paths = { appRoot, workbenchJs: join(out, 'desktop.js'), glassJs: join(out, 'glass.js'), productJson: join(appRoot, 'product.json'), hasGlass: true }
  writeFileSync(paths.workbenchJs, sources.desktop)
  writeFileSync(paths.glassJs, sources.glass)
  const checksums = Object.fromEntries(Object.entries(sources).map(([name, source]) => [`${name}.js`, hash(source)]))
  writeFileSync(paths.productJson, JSON.stringify({ checksums }))
  const config = join(root, '.magpie-ccursor')
  mkdirSync(config)
  writeFileSync(join(config, 'routes.json'), JSON.stringify({ redirect: on ? ['agent.v1.AgentService/RunSSE', 'REST:/auth/poll'] : ['REST:/auth/stripe_profile'] }))
  return { root, paths }
}
function hash(source: string) { return createHash('sha256').update(source).digest('base64').replace(/=+$/, '') }
function patch(f: ReturnType<typeof fixture>) {
  // Load routes.js only inside the sandbox process, so tests never read the user's routes.
  const result = Bun.spawnSync([process.execPath, '--eval',
    'import {patchInject} from "./vendor/installer/patch-inject.js";patchInject(JSON.parse(process.argv[1]));', JSON.stringify(f.paths)],
  { cwd: process.cwd(), env: { ...process.env, HOME: f.root, USERPROFILE: f.root } })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
function renderer(kind: keyof typeof methods) { return `${transport}\nclass Client{${methods[kind]}}` }
function payload(source: string) { return source.split('/* CURSOR-BYOK-HOOK-START */')[1].split('/* CURSOR-BYOK-HOOK-END */')[0] }
function legacy(source: string) { return source.replace(`${state}=true;`, '').replace(`${state}=false;`, '').replace(update, '').replace(guard, '') }
function runtime(source: string, officialGate = true) {
  const listeners = new Map<string, (event: { data: string }) => void>()
  const calls: Array<[string, any]> = []
  let connections = 0
  const context: any = {
    console: { log() {}, warn() {} }, document: { body: null },
    EventSource: class { constructor() { connections++ } addEventListener(name: string, handler: any) { listeners.set(name, handler) } },
    fetch() { throw new Error('Unexpected network request') },
    hrp: Object.assign, Weg: Object.assign,
  }
  // Execute only the hook and the extracted methods, never a full renderer bundle.
  runInNewContext(payload(source), context)
  context.service = { checkFeatureGate(name: string, options: any) { calls.push([name, options]); return name === 'agent_host_local_loop' ? officialGate : true } }
  const extracted = source.slice(source.lastIndexOf('class Client{'));
  runInNewContext(`${extracted};globalThis.client=new Client();client.experimentService=service;client.environmentService={enableSmokeTestDriver:false};`, context)
  return { context, calls, connections, routes(paths: unknown) { listeners.get('routes')!({ data: JSON.stringify(paths) }) } }
}

for (const kind of ['desktop', 'glass'] as const) {
  test(`patch-inject ${kind}: BYOK selects Connect and disables Graymatter; routes restore official gates`, () => {
    const f = fixture({ desktop: renderer('desktop'), glass: renderer('glass') })
    patch(f)
    const source = readFileSync(kind === 'desktop' ? f.paths.workbenchJs : f.paths.glassJs, 'utf8')
    expect(isInjectPatched(source)).toBe(true)
    expect(isLocalLoopCompatible(source)).toBe(true)
    for (const officialGate of [true, false]) {
      const vm = runtime(source, officialGate)
      expect(vm.connections).toBe(1)
      expect(vm.context.client.stampIdeClientCapabilities({})).toMatchObject({ localLoopGateEnabled: false, agentReplaceGraymatter: false })
      expect(vm.calls).toEqual([])
      vm.routes(['/auth/full_stripe_profile', '/auth/stripe_profile', '/unrelated'])
      expect(vm.context.client.stampIdeClientCapabilities({})).toMatchObject({ localLoopGateEnabled: officialGate, agentReplaceGraymatter: officialGate })
      expect(vm.calls[0]).toEqual(['agent_host_local_loop', { disableExposureLog: true }])
      if (officialGate) expect(vm.calls[1]).toEqual(['agent_replace_graymatter', { disableExposureLog: false }])
      vm.routes(['/auth/poll'])
      expect(vm.context.client.stampIdeClientCapabilities({})).toMatchObject({ localLoopGateEnabled: false, agentReplaceGraymatter: false })
      const count = vm.calls.length
      vm.routes({ malformed: true })
      expect(vm.context.client.readLocalLoopGate()).toBe(false)
      expect(vm.calls).toHaveLength(count)
    }
  })
}

test('patch-inject initializes disabled BYOK from redirect routes before any SSE event', () => {
  const f = fixture({ desktop: renderer('desktop'), glass: renderer('glass') }, false)
  patch(f)
  const vm = runtime(readFileSync(f.paths.workbenchJs, 'utf8'))
  expect(vm.context.client.readLocalLoopGate()).toBe(true)
  vm.routes(['/auth/poll'])
  expect(vm.context.client.readLocalLoopGate()).toBe(false)
})

test('patch-inject upgrades complete legacy hooks, preserves payload and backup, updates checksums, and is idempotent', () => {
  const f = fixture({ desktop: renderer('desktop'), glass: renderer('glass') })
  patch(f)
  const expected = [f.paths.workbenchJs, f.paths.glassJs].map(file => readFileSync(file, 'utf8'))
  for (const [index, file] of [f.paths.workbenchJs, f.paths.glassJs].entries()) {
    const old = legacy(expected[index])
    expect(isInjectPatched(old)).toBe(false)
    writeFileSync(file, old)
  }
  patch(f)
  for (const [index, file] of [f.paths.workbenchJs, f.paths.glassJs].entries()) {
    expect(readFileSync(file, 'utf8')).toBe(expected[index])
    const name = relative(join(f.paths.appRoot, 'out'), file)
    const backups = readdirSync(join(f.paths.appRoot, 'out')).filter(path => path.startsWith(`${name}.backup-magpie-ccursor-inject-`))
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(f.paths.appRoot, 'out', backups[0]), 'utf8')).toBe(renderer(index === 0 ? 'desktop' : 'glass'))
    const checksums = JSON.parse(readFileSync(f.paths.productJson, 'utf8')).checksums
    expect(checksums[name]).toBe(hash(expected[index]))
  }
  const product = readFileSync(f.paths.productJson, 'utf8')
  patch(f)
  expect(readFileSync(f.paths.productJson, 'utf8')).toBe(product)
  expect(readFileSync(f.paths.workbenchJs, 'utf8')).toBe(expected[0])
})

test('patch-local-loop rejects unknown, duplicate and misleading method targets without touching other gates', () => {
  for (const source of [
    `class C{${gate.replace('!0', '!1')}}`,
    `class C{${gate}${gate}}`,
    `class C{${gate}}class D{${gate.replace('!0', '!1')}}`,
    `const text=${JSON.stringify(gate)}`,
    `/* ${gate} */`,
    `class C{"readLocalLoopGate"(){return true}}`,
    'class C{other(){return this.experimentService.checkFeatureGate("agent_host_local_loop")}}',
  ]) {
    expect(() => patchLocalLoopGate(source)).toThrow(/local-loop/)
    expect(isLocalLoopCompatible(source)).toBe(false)
  }
  const source = `/* ${gate} */class C{${gate}other(){return "agent_host_local_loop"}}`
  const patched = patchLocalLoopGate(source)
  expect(patched).toBe(`/* ${gate} */class C{${gate.replace('return ', `return ${guard}`)}other(){return "agent_host_local_loop"}}`)
  expect(patchLocalLoopGate(patched)).toBe(patched)
  expect(isLocalLoopCompatible(patched)).toBe(false) // gate alone is not a working hook
})

test('patch-inject preflights both renderers and refuses unknown or partial hooks without writes', () => {
  const f = fixture({ desktop: renderer('desktop'), glass: renderer('glass').replace('disableExposureLog:!0', 'disableExposureLog:!1') })
  const original = readFileSync(f.paths.workbenchJs, 'utf8')
  expect(() => patch(f)).toThrow(/local-loop/)
  expect(readFileSync(f.paths.workbenchJs, 'utf8')).toBe(original)
  expect(readdirSync(join(f.paths.appRoot, 'out'))).toEqual(['desktop.js', 'glass.js'])
  writeFileSync(f.paths.glassJs, renderer('glass'))
  patch(f)
  const good = readFileSync(f.paths.workbenchJs, 'utf8')
  for (const broken of [
    good.replace(update, ''),
    legacy(good).replace('_restSet=new Set(newPaths);', '_restSet=new Set([]);'),
    legacy(good).replace('typeof globalThis.__byokWrapTransport===', 'typeof globalThis.__unknown==='),
  ]) {
    writeFileSync(f.paths.workbenchJs, broken)
    expect(isInjectPatched(broken)).toBe(false)
    expect(() => patch(f)).toThrow(/local-loop|partial/)
    expect(readFileSync(f.paths.workbenchJs, 'utf8')).toBe(broken)
  }
  expect(() => patchLocalLoopHook(payload(good).replace(update, ''), true)).toThrow(/partial/)
})

test('patch-inject still supports old renderers without a local-loop gate', () => {
  expect(isLocalLoopCompatible(transport)).toBe(true)
  expect(patchLocalLoopGate(transport)).toBe(transport)
  const f = fixture({ desktop: transport, glass: transport })
  patch(f)
  expect(isInjectPatched(readFileSync(f.paths.workbenchJs, 'utf8'))).toBe(true)
  patch(f)
})
