import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createCursorFixture, sandboxEnvironment } from './fixtures/cursor'
import { isInjectCurrent, isInjectPatched } from '../vendor/installer/patch-inject.js'
import { buildNodeHttp11RouterPayload, isNodeHttp11RouterPatched, stripLegacyRouterPayload } from '../vendor/installer/node-http11-router.js'
import { guardTurnRoute, isTurnRouteGuarded, assertTurnRouteShape } from '../vendor/installer/agent-turn-route-guard.js'
import { getAgentHostBackupTargets, inspectAgentHostPatch } from '../vendor/installer/patch-agent-host.js'
import { inspectAlwaysLocalPatch } from '../vendor/installer/patch-always-local.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const start = '/* CURSOR-BYOK-HOOK-START */', end = '/* CURSOR-BYOK-HOOK-END */'
const rpcRules = ['aiserver.v1.AiService/AvailableModels', 'agent.v1.AgentService/RunSSE']
const quiet = { log() {}, warn() {} }
async function fixture() {
  const root = mkdtempSync(join(process.cwd(), '.upstream-installer-test-')); roots.push(root)
  const { paths } = await createCursorFixture(join(root, 'cursor'))
  mkdirSync(join(root, '.magpie-ccursor'))
  writeFileSync(join(root, '.magpie-ccursor/routes.json'), JSON.stringify({ redirect: [...rpcRules, 'REST:/auth/poll'] }))
  return { root, paths }
}
function patch(f: Awaited<ReturnType<typeof fixture>>, modules = ['patch-inject']) {
  const functions: Record<string, string> = { 'patch-inject': 'patchInject', 'patch-agent-host': 'patchAgentHost', 'patch-always-local': 'patchAlwaysLocal' }
  const script = modules.map(module => `import {${functions[module]}} from './vendor/installer/${module}.js';${functions[module]}(JSON.parse(process.argv[1]));`).join('\n')
  const result = Bun.spawnSync([process.execPath, '--eval', script, JSON.stringify(f.paths)], { cwd: process.cwd(), env: sandboxEnvironment(f.root) })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
function payload(source: string) { return source.slice(source.indexOf(start) + start.length, source.indexOf(end)) }
let renderers: { desktop: string; glass: string } | undefined
async function renderer(label: 'glass' | 'desktop' = 'glass') {
  if (!renderers) {
    const f = await fixture(); patch(f)
    renderers = { desktop: readFileSync(f.paths.workbenchJs, 'utf8'), glass: readFileSync(f.paths.glassJs, 'utf8') }
  }
  return renderers[label]
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
class Message {
  value: any
  constructor(value: any) { this.value = value }
  toBinary() { return encode(this.value) }
  static fromBinary(data: Uint8Array) { return JSON.parse(new TextDecoder().decode(data)) }
}
const service = { typeName: 'aiserver.v1.AiService' }
const unary = { name: 'AvailableModels', kind: 0, I: Message, O: Message }
const streaming = { name: 'RunSSE', kind: 1, I: Message, O: Message }
const agent = { typeName: 'agent.v1.AgentService' }
function runtime(source: string, localFetch: (url: string, init: any) => any = () => new Response(encode({ models: [] })), withButton = false) {
  const listeners = new Map<string, (event: any) => void>(), requests: Array<{ url: string; init: any }> = []
  const calls = { unary: 0, stream: 0, events: 0, consumed: 0 }
  let button: any
  const gear = { parentElement: { insertBefore(value: any) { button = value } } }
  const document = {
    body: withButton ? {} : null, contains() { return true },
    querySelector(selector: string) { return selector === '[data-component="glass-sidebar-footer"]' ? { querySelector() { return gear } } : null },
    createElement() { return { dataset: {}, style: {}, listeners: {} as Record<string, any>, addEventListener(name: string, fn: any) { this.listeners[name] = fn } } },
  }
  const context: any = {
    console: quiet, window: { vscodeWindowId: 47 }, document,
    Headers, Request, Uint8Array, DataView, TextDecoder, AbortSignal,
    MutationObserver: class { observe() {} },
    EventSource: class { constructor() { calls.events++ } addEventListener(name: string, fn: any) { if (listeners.has(name)) throw new Error(`duplicate event ${name}`); listeners.set(name, fn) } },
    setTimeout() {},
    fetch(url: string, init: any) {
      if (url.endsWith('/hook')) return Promise.resolve(new Response('{}'))
      requests.push({ url, init }); return Promise.resolve().then(() => localFetch(url, init))
    },
  }
  runInNewContext(payload(source), context)
  const transport = context.__byokWrapTransport({
    async unary() { calls.unary++; return { message: { official: true } } },
    async stream(_s: any, _m: any, _signal: any, _timeout: any, _headers: any, input: any) {
      calls.stream++; for await (const _ of input) calls.consumed++
      return { message: (async function* () { yield { official: true } })() }
    },
  })
  return { context, calls, requests, transport, get button() { return button }, emit(name: string, data?: unknown) { listeners.get(name)!({ data: JSON.stringify(data) }) } }
}
const input = async function* () { yield new Message({ prompt: 'hello' }) }
async function collect(iter: AsyncIterable<any>) { const values = []; for await (const value of iter) values.push(value); return values }
async function settle() { for (let i = 0; i < 40; i++) await Promise.resolve() }
function frame(flags: number, data: unknown) {
  const bytes = encode(data), framed = new Uint8Array(bytes.length + 5)
  framed[0] = flags; new DataView(framed.buffer).setUint32(1, bytes.length); framed.set(bytes, 5)
  return framed
}
function streamResponse(frames: Uint8Array[]) {
  const bytes = new Uint8Array(frames.reduce((n, item) => n + item.length, 0)); let offset = 0
  for (const item of frames) { bytes.set(item, offset); offset += item.length }
  // Split the header and payload across arbitrary reads, as a real Connect response can.
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() } }))
}

test('upstream-installer Agent Window routes only advertised RPCs; IDE and unmatched methods keep native transport', async () => {
  for (const label of ['glass', 'desktop'] as const) {
    const vm = runtime(await renderer(label), () => new Response(encode({ local: true }), { headers: { 'trailer-catalog': 'ready' } }))
    const call = (method = unary, headers: any = { authorization: 'fixture-token' }) => vm.transport.unary(service, method, undefined, 500, headers, { useModelParameters: true })
    expect((await call()).message).toEqual({ official: true })
    vm.emit('rpc-routes', rpcRules)
    const response = await call()
    expect(response.message).toEqual(label === 'glass' ? { local: true } : { official: true })
    if (label === 'glass') {
      const request = vm.requests[0]
      expect(request.url).toBe('http://127.0.0.1:39831/aiserver.v1.AiService/AvailableModels')
      expect(Object.fromEntries(request.init.headers)).toMatchObject({ 'x-client-wid': '47', authorization: 'fixture-token', 'content-type': 'application/proto', 'connect-protocol-version': '1', 'connect-timeout-ms': '500' })
      expect(JSON.parse(new TextDecoder().decode(request.init.body))).toEqual({ useModelParameters: true })
      expect(response.trailer.get('catalog')).toBe('ready')
    } else expect(vm.requests).toHaveLength(0)
    expect((await call({ ...unary, name: 'NotRouted' })).message).toEqual({ official: true })
    vm.emit('rpc-routes', ['aiserver.v1.AiService'])
    expect((await call({ ...unary, name: 'NotRouted' })).message).toEqual(label === 'glass' ? { local: true } : { official: true })
    vm.emit('rpc-routes', [])
    expect((await call()).message).toEqual({ official: true })
    expect(vm.calls.events).toBe(1)
  }
})

test('upstream-installer Agent Window unary falls back only on unreachable network, retaining business errors and aborts', async () => {
  const source = await renderer()
  const network = runtime(source, () => { throw new TypeError('offline') }); network.emit('rpc-routes', rpcRules)
  expect((await network.transport.unary(service, unary, undefined, undefined, [], {})).message).toEqual({ official: true })
  const business = runtime(source, () => new Response(JSON.stringify({ code: 'permission_denied', message: 'denied' }), { status: 403 })); business.emit('rpc-routes', rpcRules)
  await expect(business.transport.unary(service, unary, undefined, undefined, {}, {})).rejects.toMatchObject({ code: 7, rawMessage: 'denied' })
  expect(business.calls.unary).toBe(0)
  const controller = new AbortController(); controller.abort()
  const aborted = runtime(source, () => { throw controller.signal.reason }); aborted.emit('rpc-routes', rpcRules)
  await expect(aborted.transport.unary(service, unary, controller.signal, undefined, {}, {})).rejects.toBe(controller.signal.reason)
  expect(aborted.calls.unary).toBe(0)
})

test('upstream-installer Agent Window decodes fragmented Connect server streams, trailers and terminal errors', async () => {
  const source = await renderer()
  const vm = runtime(source, () => streamResponse([frame(0, { text: 'one' }), frame(0, { text: 'two' }), frame(2, { metadata: { catalog: ['ready'] } })]))
  vm.emit('rpc-routes', rpcRules)
  const response = await vm.transport.stream(agent, streaming, undefined, undefined, {}, input())
  expect(await collect(response.message)).toEqual([{ text: 'one' }, { text: 'two' }])
  expect(response.trailer.get('catalog')).toBe('ready')
  expect(vm.requests[0].init.headers.get('content-type')).toBe('application/connect+proto')
  const request = vm.requests[0].init.body
  expect(request[0]).toBe(0); expect(new DataView(request.buffer).getUint32(1)).toBe(request.length - 5)
  expect(JSON.parse(new TextDecoder().decode(request.slice(5)))).toEqual({ prompt: 'hello' })
  expect(vm.calls.stream).toBe(0)
  for (const [frames, code] of [[ [frame(2, { error: { code: 'resource_exhausted', message: 'quota' } })], 8 ], [ [frame(0, { text: 'cut' }).slice(0, -1)], 15 ]] as const) {
    const failed = runtime(source, () => streamResponse([...frames])); failed.emit('rpc-routes', rpcRules)
    const result = await failed.transport.stream(agent, streaming, undefined, undefined, {}, input())
    await expect(collect(result.message)).rejects.toMatchObject({ code })
    expect(failed.calls.stream).toBe(0)
  }
})

test('upstream-installer rejects missing, malformed or invalid end-stream frames and releases response readers', async () => {
  const source = await renderer()
  const invalidJson = frame(2, {})
  invalidJson[5] = 0x78
  for (const frames of [[frame(0, { text: 'complete-data-but-no-end' })], [invalidJson], [frame(2, null)],
    [frame(2, { metadata: { broken: 'not-an-array' } })], [frame(2, { error: { code: 123 } })]]) {
    const body = streamResponse(frames)
    const vm = runtime(source, () => body); vm.emit('rpc-routes', rpcRules)
    const response = await vm.transport.stream(agent, streaming, undefined, undefined, {}, input())
    await expect(collect(response.message)).rejects.toMatchObject({ code: 15 })
    expect(body.body!.locked).toBe(false)
    expect(vm.calls.stream).toBe(0)
  }
})

test('upstream-installer never replays consumed streams; unsupported streaming kinds use native input intact', async () => {
  const vm = runtime(await renderer(), () => { throw new TypeError('offline') }); vm.emit('rpc-routes', rpcRules)
  await expect(vm.transport.stream(agent, streaming, undefined, undefined, {}, input())).rejects.toMatchObject({ code: 14 })
  expect(vm.calls.stream).toBe(0)
  for (const kind of [2, 3]) {
    const result = await vm.transport.stream(agent, { ...streaming, kind }, undefined, undefined, {}, input())
    expect(await collect(result.message)).toEqual([{ official: true }])
  }
  expect(vm.calls.consumed).toBe(2)
})

test('upstream-installer rpc-routes retries catalog after initial native rejection, preserving local-loop ON/OFF', async () => {
  const vm = runtime(await renderer(), () => new Response(encode({ models: [{ name: 'magpie' }], displayConfiguration: { routedModelViewConfig: { hideRoutedModelView: true } }, composerModelConfig: { defaultModel: 'magpie' } }), { headers: { 'x-magpie-ccursor-catalog': '1' } }))
  const storage: any = { availableDefaultModels2: [{ name: 'official' }], modelPickerDisplayConfiguration: {}, featureModelConfigs: {} }
  let native = 0
  const aiService = {
    _reactiveStorageService: { applicationUserPersistentStorage: storage, setApplicationUserPersistentStorage(key: string, value: any) { storage[key] = value }, onChangeEffectManuallyDisposed() { return { dispose() {} } } },
    async refreshDefaultModels() { native++ },
    async aiClient() { return { async availableModels(request: any, options: any) { const response = await vm.transport.unary(service, unary, undefined, undefined, {}, request); options.onHeader(response.header ?? new Headers()); return response.message } } },
    persistAvailableDefaultModels(value: any) { storage.availableDefaultModels2 = value },
    persistFeatureModelConfigs(value: any) { storage.featureModelConfigs = { composer: value.composerModelConfig } },
  }
  vm.context.__byokAiSvc = aiService
  await settle()
  expect(vm.context.__magpieCcursorConnectMode).toBe(true)
  expect(storage.availableDefaultModels2).toEqual([{ name: 'official' }])
  expect(vm.context.__magpieCatalogSync.status().services[0].state).toBe('fetch-or-apply-failed')
  vm.emit('routes', ['/auth/poll']); await settle()
  vm.emit('rpc-routes', rpcRules); await settle()
  expect(storage.availableDefaultModels2).toEqual([{ name: 'magpie' }])
  expect(vm.context.__magpieCatalogSync.status().services[0].state).toBe('ready')
  vm.emit('routes', []); vm.emit('rpc-routes', []); await settle()
  expect(vm.context.__magpieCcursorConnectMode).toBe(false)
  expect(storage.availableDefaultModels2).toEqual([{ name: 'official' }])
  expect(native).toBeGreaterThan(0)
})

test('upstream-installer glass mode button sends idempotent target with legacy 404 fallback', async () => {
  for (const legacy of [false, true]) {
    const vm = runtime(await renderer(), url => url.endsWith('/byok/mode') && legacy ? new Response('{}', { status: 404 }) : new Response('{"byokMode":1}'), true)
    vm.context.__byokGlassStatus(true, false)
    vm.button.listeners.click(); vm.button.listeners.click(); await settle()
    const mode = vm.requests.filter(request => request.url.endsWith('/byok/mode'))
    expect(mode).toHaveLength(2)
    for (const request of mode) expect(JSON.parse(request.init.body)).toEqual({ byokMode: 1, source: 'glass' })
    expect(vm.requests.filter(request => request.url.endsWith('/byok/toggle'))).toHaveLength(legacy ? 2 : 0)
    vm.context.__byokGlassStatus(true, true); vm.button.listeners.click(); await settle()
    expect(JSON.parse(vm.requests.filter(request => request.url.endsWith('/byok/mode')).at(-1)!.init.body).byokMode).toBe(0)
  }
})

test('upstream-installer upgrades baseline 0.2.6 payload in place with helpers and backups intact', async () => {
  // Actual baseline payload generated from 493f56a's patch-inject.js, not a rev2 marker mutation.
  const legacyPayload = readFileSync(join(import.meta.dir, 'fixtures/upstream-installer-026-hook.js'), 'utf8')
  const f = await fixture(); patch(f)
  const originals = new Map<string, string>()
  for (const file of [f.paths.workbenchJs, f.paths.glassJs]) {
    const source = readFileSync(file, 'utf8'), old = start + legacyPayload + source.slice(source.indexOf(end))
    originals.set(file, source)
    expect(isInjectPatched(old)).toBe(true); expect(isInjectCurrent(old)).toBe(false)
    writeFileSync(file, old)
  }
  const backups = readdirSync(join(f.paths.appRoot, 'out/vs/workbench'))
  patch(f)
  for (const [file, expected] of originals) {
    const source = readFileSync(file, 'utf8')
    expect(source).toBe(expected); expect(isInjectCurrent(source)).toBe(true)
    expect(source.split(start)).toHaveLength(2)
    expect(source.split('/* MAGPIE-CATALOG-SYNC-1 */')).toHaveLength(2)
  }
  expect(readdirSync(join(f.paths.appRoot, 'out/vs/workbench'))).toEqual(backups)
  const product = readFileSync(f.paths.productJson, 'utf8'); patch(f)
  expect(readFileSync(f.paths.productJson, 'utf8')).toBe(product)
})

test('upstream-installer legacy upgrade rejects corrupted helpers and unknown revisions before either renderer changes', async () => {
  const f = await fixture(); patch(f)
  const desktop = readFileSync(f.paths.workbenchJs, 'utf8'), glass = readFileSync(f.paths.glassJs, 'utf8')
  const legacyPayload = readFileSync(join(import.meta.dir, 'fixtures/upstream-installer-026-hook.js'), 'utf8')
  const old = start + legacyPayload + desktop.slice(desktop.indexOf(end))
  for (const broken of [glass.replace('var records=new Map()', 'var records=null'), glass.replace('__byokHookRev2', '__byokHookRev99'), glass.replace('CURSOR-BYOK-HOOK-END', 'MISSING-END')]) {
    writeFileSync(f.paths.workbenchJs, old); writeFileSync(f.paths.glassJs, broken)
    expect(() => patch(f)).toThrow()
    expect(readFileSync(f.paths.workbenchJs, 'utf8')).toBe(old)
    expect(readFileSync(f.paths.glassJs, 'utf8')).toBe(broken)
  }
})

function routerRuntime() {
  let config: any = { server: { host: '127.0.0.1', port: 39831 }, redirect: rpcRules }, stamp = 1, removed = false
  const calls: any[] = [], watched: string[] = []
  const direct = { request(...args: any[]) { calls.push({ kind: 'direct', args }); return { end() { calls.push({ kind: 'end' }) } } } }
  const http: any = { __vscodeOriginal: direct, request(...args: any[]) { calls.push({ kind: 'http', args }) }, get() { calls.push({ kind: 'http-get' }) } }
  const https: any = { request(...args: any[]) { calls.push({ kind: 'https', args }) }, get() { calls.push({ kind: 'https-get' }) } }
  let synced = 0
  const modules: Record<string, any> = {
    http, https, path: { join: (...parts: string[]) => parts.join('/') }, os: { homedir: () => '/sandbox' },
    fs: { statSync() { if (removed) throw new Error('ENOENT'); return { mtimeMs: stamp, size: JSON.stringify(config).length } }, readFileSync() { if (removed) throw new Error('ENOENT'); return JSON.stringify(config) }, watchFile(path: string) { watched.push(path) } },
    module: { syncBuiltinESMExports() { synced++ } },
  }
  const context: any = { require: (name: string) => modules[name], console: quiet, URL, Headers, process: { env: { VSCODE_PROCESS_TITLE: 'extensionHost [47-1]' } } }
  const source = buildNodeHttp11RouterPayload({ guardMarker: '__byokAgentHostUrlRewrite', processLabel: 'agent-host' })
  runInNewContext(source, context)
  return { context, source, calls, watched, http, https, get synced() { return synced }, reload(value: any) { config = value; stamp++; removed = false }, remove() { removed = true } }
}

test('upstream-installer Node V3 routes reload on first request/turn and retain host/header boundaries', () => {
  const vm = routerRuntime()
  expect(vm.watched).toEqual(['/sandbox/.magpie-ccursor/routes.json']); expect(vm.synced).toBe(1)
  expect(vm.context.__byokRpcRouted('/agent.v1.AgentService/RunSSE?x=1#hash')).toBe(true)
  vm.https.request('https://api2.cursor.sh/agent.v1.AgentService/RunSSE', { headers: { host: 'api2.cursor.sh', authorization: 'fixture', 'x-client-wid': '99' }, agent: {} })
  expect(vm.calls[0].kind).toBe('direct')
  expect(vm.calls[0].args[0]).toBe('http://127.0.0.1:39831/agent.v1.AgentService/RunSSE')
  expect(vm.calls[0].args[1]).toMatchObject({ agent: false, headers: { authorization: 'fixture', 'x-client-wid': '99', 'x-byok-route-source': 'agent-host' } })
  expect(vm.calls[0].args[1].headers.host).toBeUndefined()
  vm.https.request('https://example.test/agent.v1.AgentService/RunSSE'); expect(vm.calls.at(-1).kind).toBe('https')
  vm.reload({ server: { host: '::1', port: 41234 }, redirect: ['agent.v1.AgentService', 'REST:/auth/poll'] })
  vm.https.get('https://api3.cursor.sh/agent.v1.AgentService/Other')
  expect(vm.calls.at(-2).args[0]).toBe('http://[::1]:41234/agent.v1.AgentService/Other')
  expect(vm.calls.at(-2).args[1].headers['x-client-wid']).toBe('47')
  expect(vm.calls.at(-1).kind).toBe('end')
  vm.reload({ redirect: [] })
  expect(vm.context.__byokRpcRouted('/agent.v1.AgentService/RunSSE')).toBe(false)
  vm.https.request('https://api2.cursor.sh/agent.v1.AgentService/RunSSE'); expect(vm.calls.at(-1).kind).toBe('https')
  vm.reload({ redirect: rpcRules }); expect(vm.context.__byokRpcRouted('/agent.v1.AgentService/RunSSE')).toBe(true)
  vm.remove(); expect(vm.context.__byokRpcRouted('/agent.v1.AgentService/RunSSE')).toBe(false)
  const request = vm.http.request; runInNewContext(vm.source, vm.context)
  expect(vm.http.request).toBe(request); expect(vm.synced).toBe(1)
})

// The eligible route literal is the exact upstream Cursor 3.16.29+ AST target.
const turnSource = 'var logger="agent-host:turn-routing";function chooseTurn(eligible){return eligible?{runtime:"managed-local",reason:"eligible"}:{runtime:"connect",reason:"credentials",disposition:"fallback"}}'
test('upstream-installer Agent Host per-turn guard follows live RunSSE routing while OFF and credential routes retain Cursor behavior', () => {
  const guarded = guardTurnRoute(turnSource)
  expect(guarded.changed).toBe(1); expect(isTurnRouteGuarded(guarded.source)).toBe(true)
  expect(guardTurnRoute(guarded.source).source).toBe(guarded.source)
  const vm = routerRuntime(); runInNewContext(guarded.source, vm.context)
  expect(vm.context.chooseTurn(true)).toEqual({ runtime: 'connect', reason: 'byok-connect-routed', disposition: 'fallback' })
  expect(vm.context.chooseTurn(false)).toEqual({ runtime: 'connect', reason: 'credentials', disposition: 'fallback' })
  vm.reload({ redirect: [] })
  expect(vm.context.chooseTurn(true)).toEqual({ runtime: 'managed-local', reason: 'eligible' })
  delete vm.context.__byokRpcRouted
  expect(vm.context.chooseTurn(true)).toEqual({ runtime: 'managed-local', reason: 'eligible' })
  expect(isTurnRouteGuarded(guarded.source.replace('"/agent.v1.AgentService/RunSSE"', '"/wrong"'))).toBe(false)
  expect(isTurnRouteGuarded(guarded.source.replace('reason:"byok-connect-routed"', 'reason:"wrong"'))).toBe(false)
  expect(() => assertTurnRouteShape([{ file: 'changed.js', source: turnSource.replace('reason:"eligible"', 'reason:"new-shape"') }])).toThrow(/shape changed/)
  const comments = `/* ${turnSource} */var text=${JSON.stringify(turnSource)};`
  expect(guardTurnRoute(comments).changed).toBe(0)
})

test('upstream-installer Node V2 migration replaces one payload; Agent Host guards entry and lazy chunks with separate Magpie backups', async () => {
  const f = await fixture()
  const lazy = join(f.paths.agentHostDist, 'turn.js')
  writeFileSync(lazy, turnSource)
  writeFileSync(f.paths.agentHostMain, readFileSync(f.paths.agentHostMain, 'utf8') + turnSource.replace('chooseTurn', 'chooseEntryTurn'))
  // Actual V2 payload from baseline 493f56a, before the per-turn guard existed.
  // Installers must upgrade even when historical process guard markers exist.
  const legacyRouter = readFileSync(join(import.meta.dir, 'fixtures/upstream-installer-026-router.js'), 'utf8')
  writeFileSync(f.paths.agentHostMain, legacyRouter + readFileSync(f.paths.agentHostMain, 'utf8'))
  writeFileSync(f.paths.alwaysLocalMain, legacyRouter.replaceAll('__byokAgentHostUrlRewrite', '__byokUrlRewrite').replace('PROCESS_LABEL="agent-host"', 'PROCESS_LABEL="always-local"') + readFileSync(f.paths.alwaysLocalMain, 'utf8'))
  expect(inspectAgentHostPatch(f.paths)).toMatchObject({ fullyPatched: false, turnRoute: false, turnRouteRequired: true })
  expect(inspectAlwaysLocalPatch(f.paths).fullyPatched).toBe(false)
  patch(f, ['patch-agent-host', 'patch-always-local'])
  const state = inspectAgentHostPatch(f.paths)
  expect(state).toMatchObject({ fullyPatched: true, turnRoute: true, turnRouteRequired: true })
  expect(inspectAlwaysLocalPatch(f.paths).fullyPatched).toBe(true)
  for (const [file, guard] of [[f.paths.agentHostMain, '__byokAgentHostUrlRewrite'], [f.paths.alwaysLocalMain, '__byokUrlRewrite']]) {
    const source = readFileSync(file, 'utf8')
    expect(isNodeHttp11RouterPatched(source, guard)).toBe(true)
    expect(source).not.toContain('BYOK-HTTP11-ROUTER-V2')
    expect(source.split('_http.request=interceptRequest(false)')).toHaveLength(2)
    expect(stripLegacyRouterPayload(source)).toBe(source)
  }
  expect(getAgentHostBackupTargets(f.paths)).toContain(lazy)
  expect(readdirSync(f.paths.agentHostDist).filter(name => name.startsWith('turn.js.backup-magpie-ccursor-agent-host-'))).toHaveLength(1)
  expect(readdirSync(f.paths.agentHostDist).some(name => name.includes('.backup-byok-'))).toBe(false)
  expect(isTurnRouteGuarded(readFileSync(lazy, 'utf8'))).toBe(true)
  const files = [f.paths.agentHostMain, f.paths.alwaysLocalMain, lazy, f.paths.productJson], before = files.map(file => readFileSync(file, 'utf8'))
  patch(f, ['patch-agent-host', 'patch-always-local'])
  expect(files.map(file => readFileSync(file, 'utf8'))).toEqual(before)
})

test('upstream-installer Agent Host unknown turn shape fails preflight without writes', async () => {
  const f = await fixture(), lazy = join(f.paths.agentHostDist, 'turn.js')
  writeFileSync(lazy, turnSource.replace('reason:"eligible"', 'reason:"unsupported"'))
  const before = [f.paths.agentHostMain, f.paths.productJson].map(file => readFileSync(file, 'utf8'))
  expect(() => patch(f, ['patch-agent-host'])).toThrow(/shape changed/)
  expect([f.paths.agentHostMain, f.paths.productJson].map(file => readFileSync(file, 'utf8'))).toEqual(before)
  expect(readdirSync(f.paths.agentHostDist).some(name => name.includes('.backup-'))).toBe(false)
})
