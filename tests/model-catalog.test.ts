import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { isInjectPatched, isModelCatalogCompatible } from '../vendor/installer/patch-inject.js'
import { patchModelCatalogHook, upgradeModelCatalogHook } from '../vendor/installer/patch-model-catalog.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const transport = '// callback-client.js\nfunction dispatch(service,transport){return [service.Unary,service.ServerStreaming,service.BiDiStreaming,transport]}\nfunction client(service,transport){return dispatch(service,transport)}'
const renderer = `${transport}\nfunction capture(owner){return owner.aiService.refreshDefaultModels()}class Client{readLocalLoopGate(){return this.experimentService.checkFeatureGate("agent_host_local_loop",{disableExposureLog:!0})}}`
function fixture() {
  const root = mkdtempSync(join(process.cwd(), '.model-catalog-test-'))
  roots.push(root)
  const appRoot = join(root, 'cursor'), out = join(appRoot, 'out')
  mkdirSync(out, { recursive: true })
  const paths = { appRoot, workbenchJs: join(out, 'desktop.js'), glassJs: join(out, 'glass.js'), productJson: join(appRoot, 'product.json'), hasGlass: true }
  writeFileSync(paths.workbenchJs, renderer)
  writeFileSync(paths.glassJs, renderer)
  writeFileSync(paths.productJson, JSON.stringify({ checksums: {} }))
  mkdirSync(join(root, '.magpie-ccursor'))
  writeFileSync(join(root, '.magpie-ccursor/routes.json'), JSON.stringify({ redirect: ['agent.v1.AgentService/RunSSE', 'REST:/auth/poll'] }))
  return { root, paths }
}
function patch(f: ReturnType<typeof fixture>) {
  const result = Bun.spawnSync([process.execPath, '--eval',
    'import {patchInject} from "./vendor/installer/patch-inject.js";patchInject(JSON.parse(process.argv[1]));', JSON.stringify(f.paths)],
  { cwd: process.cwd(), env: { ...process.env, HOME: f.root, USERPROFILE: f.root } })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
function payload(source: string) { return source.split('/* CURSOR-BYOK-HOOK-START */')[1].split('/* CURSOR-BYOK-HOOK-END */')[0] }
function oldHook(source: string) {
  return source.replace(/\/\* MAGPIE-CATALOG-SYNC-1 \*\/[\s\S]*?\/\* MAGPIE-CATALOG-SYNC-END \*\//, '')
    .replace(/globalThis\.__magpieCatalogSync&&globalThis\.__magpieCatalogSync\.(mode|open|disconnect)\(\);/g, '')
}
let freshSource: string
function source() {
  if (!freshSource) {
    const f = fixture(); patch(f)
    freshSource = readFileSync(f.paths.glassJs, 'utf8')
  }
  return freshSource
}
const keys = ['availableDefaultModels2', 'modelPickerDisplayConfiguration', 'featureModelConfigs']
function rows(count: number, prefix = 'official') { return Array.from({ length: count }, (_, index) => ({ name: `${prefix}-${index}`, category: 2 })) }
function storage() {
  const state: any = {
    availableDefaultModels2: rows(46),
    modelPickerDisplayConfiguration: { hideRoutedModelView: false, namedModelsViewConfig: { namedViewToRoutedModelViewToggle: {} } },
    featureModelConfigs: { composer: { defaultModel: 'official-0' } },
  }
  const observers = new Set<any>(), writes: string[] = []
  // Fail if the synchronizer ever accesses credentials, uiState, aiSettings, etc.
  const guarded = new Proxy(state, { get(target, key: string) { if (!keys.includes(key)) throw new Error(`Unexpected storage read: ${key}`); return target[key] } })
  const api = {
    applicationUserPersistentStorage: guarded,
    setApplicationUserPersistentStorage(key: string, value: any) {
      if (!keys.includes(key)) throw new Error(`Unexpected storage write: ${key}`)
      writes.push(key)
      // Cursor's Solid store merges object members and deletes undefined fields.
      if (state[key] && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const member of Object.keys(value)) {
          if (value[member] === undefined) delete state[key][member]
          else state[key][member] = value[member]
        }
      } else state[key] = value
      for (const observer of observers) {
        const next = observer.deps.map((read: any) => read())
        if (next.some((value: any, index: number) => value !== observer.previous[index])) {
          observer.previous = next; observer.onChange()
        }
      }
    },
    onChangeEffectManuallyDisposed(observer: any) {
      observer.previous = observer.deps.map((read: any) => read())
      observers.add(observer)
      return { dispose() { observers.delete(observer) } }
    },
  }
  return { api, state, observers, writes }
}
function response(count = 58, prefix = 'magpie') {
  return { models: rows(count, prefix), displayConfiguration: { routedModelViewConfig: { hideRoutedModelView: true }, hideRoutedModelView: true, namedModelsViewConfig: { namedViewToRoutedModelViewNoButton: {} } }, composerModelConfig: { defaultModel: `${prefix}-0` } }
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function service(store = storage()) {
  let getResponse: () => any = () => response()
  const calls = { available: 0, native: 0, migrate: 0, changed: 0 }
  const requests: any[] = []
  const instance = {
    _reactiveStorageService: store.api,
    _modelConfigService: { triggerParameterizedModelConfigMigration() { calls.migrate++ } },
    _aiSettingsService: { handleAvailableModelsChange() { calls.changed++ } },
    async aiClient() { return { availableModels(request: any, options: any) { calls.available++; requests.push(request); options.onHeader(new Headers({ 'x-magpie-ccursor-catalog': '1' })); return getResponse() } } },
    async refreshDefaultModels() { calls.native++ },
    persistAvailableDefaultModels(models: any) { store.api.setApplicationUserPersistentStorage(keys[0], models) },
    persistFeatureModelConfigs(result: any) { store.api.setApplicationUserPersistentStorage(keys[2], { composer: result.composerModelConfig ?? { defaultModel: 'default' } }) },
  }
  return { instance, store, calls, requests, respond(fn: () => any) { getResponse = fn } }
}
function runtime(on = true, initial?: any) {
  const listeners = new Map<string, Array<(event: any) => void>>()
  let connections = 0
  const context: any = {
    __byokAiSvc: initial,
    console: { log() {}, warn() {} }, document: { body: null, querySelector() { return null } },
    EventSource: class {
      constructor() { connections++ }
      addEventListener(name: string, handler: any) { listeners.set(name, [...(listeners.get(name) ?? []), handler]) }
    },
    fetch() { throw new Error('Unexpected network request') },
    setTimeout() { throw new Error('Unexpected timer') }, setInterval() { throw new Error('Unexpected polling') },
  }
  const hook = payload(source()).replace('globalThis.__magpieCcursorConnectMode=true;', `globalThis.__magpieCcursorConnectMode=${on};`)
  runInNewContext(hook, context)
  return {
    context, listeners, get connections() { return connections },
    register(s: ReturnType<typeof service>) { context.__byokAiSvc = s.instance },
    emit(name: string, data?: unknown) { for (const listener of listeners.get(name) ?? []) listener({ data: JSON.stringify(data) }) },
    again() { runInNewContext(hook, context) },
  }
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve() }

test('model-catalog captures every service, syncs init/manual/SSE refresh and reuses the sole EventSource', async () => {
  const vm = runtime(), a = service(), b = service()
  vm.register(a); vm.register(b); vm.register(a)
  await settle()
  for (const s of [a, b]) {
    expect(s.calls.available).toBe(1)
    expect(s.calls.native).toBe(0)
    expect(s.requests).toEqual([{ useModelParameters: true, useReactModelPicker: true }])
    expect(s.store.state.availableDefaultModels2).toHaveLength(58)
    expect(s.store.state.modelPickerDisplayConfiguration).toMatchObject({ hideRoutedModelView: true, namedModelsViewConfig: { namedViewToRoutedModelViewToggle: null, namedViewToRoutedModelViewButton: null } })
    expect(s.store.state.featureModelConfigs.composer.defaultModel).toBe('magpie-0')
  }
  vm.context.__byokRefreshModels(); await settle()
  vm.emit('refresh'); await settle()
  vm.emit('open'); await settle()
  vm.emit('routes', ['/auth/poll']); await settle()
  expect(a.calls.available).toBe(5); expect(b.calls.available).toBe(5)
  vm.again()
  expect(vm.connections).toBe(1)
  expect([...vm.listeners.values()].every(list => list.length === 1)).toBe(true)
  expect(a.store.observers.size).toBe(1)
  expect(isInjectPatched(source())).toBe(true)
})

test('model-catalog repairs an old official 46-model overwrite and does not loop on equal content', async () => {
  const vm = runtime(), s = service()
  vm.register(s); await settle()
  s.store.api.setApplicationUserPersistentStorage(keys[0], rows(46))
  s.store.api.setApplicationUserPersistentStorage(keys[1], { hideRoutedModelView: false })
  s.store.api.setApplicationUserPersistentStorage(keys[2], { composer: { defaultModel: 'old' } })
  await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  expect(s.store.state.modelPickerDisplayConfiguration.hideRoutedModelView).toBe(true)
  expect(s.store.state.featureModelConfigs.composer.defaultModel).toBe('magpie-0')
  const count = s.store.writes.length
  s.store.api.setApplicationUserPersistentStorage(keys[0], rows(58, 'magpie'))
  await settle()
  expect(s.store.writes).toHaveLength(count + 1)
  expect(s.calls.available).toBe(1)
})

test('model-catalog updates own-key cached models after stale reactive adoption and restores that cache on OFF', async () => {
  const vm = runtime(), s = service()
  let cached = JSON.stringify(s.store.state.availableDefaultModels2)
  s.instance.persistAvailableDefaultModels = models => {
    const serialized = JSON.stringify(models)
    if (cached !== serialized) {
      s.store.api.setApplicationUserPersistentStorage(keys[0], models)
      cached = serialized
    }
  }
  vm.register(s); await settle()
  s.store.api.setApplicationUserPersistentStorage(keys[0], rows(46)); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  vm.emit('routes', []); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(46)
  expect(JSON.parse(cached)).toHaveLength(46)
  vm.emit('routes', ['/auth/poll']); await settle()
  s.respond(() => response(61, 'failed'))
  s.instance.persistFeatureModelConfigs = () => { throw new Error('feature write failed') }
  vm.emit('refresh'); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  expect(JSON.parse(cached)).toHaveLength(58)
})

test('model-catalog does not pin an official response while local routing initializes', async () => {
  const vm = runtime(), s = service()
  const nativeClient = s.instance.aiClient
  s.instance.aiClient = async () => ({ availableModels() { return response() } }) as any
  vm.register(s); await settle()
  expect(vm.context.__magpieCatalogSync.status().services[0].state).toBe('fetch-or-apply-failed')
  expect(s.store.state.availableDefaultModels2).toHaveLength(46)
  s.instance.aiClient = nativeClient
  s.respond(() => response()); vm.emit('routes', ['/auth/poll']); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
})

test('model-catalog OFF and disconnect withdraw all three fields, dispose observers and resume native refresh', async () => {
  const vm = runtime(false), s = service()
  const baseline = structuredClone(s.store.state)
  vm.register(s); await settle()
  expect(s.calls.available).toBe(0)
  await s.instance.refreshDefaultModels()
  expect(s.calls.native).toBe(1)
  vm.emit('routes', ['/auth/poll']); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  vm.emit('routes', []); await settle()
  expect(s.store.state).toEqual(baseline)
  expect(s.store.observers.size).toBe(0)
  expect(s.calls.native).toBe(2)
  s.store.api.setApplicationUserPersistentStorage(keys[0], rows(10)); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(10)
  vm.emit('routes', ['/auth/poll']); await settle()
  vm.emit('error'); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(10)
  expect(vm.context.__magpieCatalogSync.status().active).toBe(false)
  vm.emit('open'); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  expect(s.store.observers.size).toBe(1)
})

test('model-catalog rejects late ON/OFF/ON responses and queued repairs after OFF', async () => {
  const vm = runtime(), s = service(), first = deferred<any>(), second = deferred<any>()
  s.respond(() => first.promise); vm.register(s); await settle()
  vm.emit('routes', []); await settle()
  first.resolve(response(60, 'stale')); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(46)
  s.respond(() => second.promise); vm.emit('routes', ['/auth/poll']); await settle()
  vm.emit('routes', []); await settle()
  s.respond(() => response(58, 'new')); vm.emit('routes', ['/auth/poll']); await settle()
  second.resolve(response(61, 'stale2')); await settle()
  expect(s.store.state.availableDefaultModels2[0].name).toBe('new-0')
  s.store.api.setApplicationUserPersistentStorage(keys[0], rows(46))
  vm.emit('routes', []); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(46)
})

test('model-catalog refresh invalidates an older pending request; empty response clears old models', async () => {
  const vm = runtime(), s = service(), old = deferred<any>()
  s.respond(() => old.promise); vm.register(s); await settle()
  s.respond(() => response(0)); vm.emit('refresh'); await settle()
  expect(s.store.state.availableDefaultModels2).toEqual([])
  old.resolve(response()); await settle()
  expect(s.store.state.availableDefaultModels2).toEqual([])
  expect(vm.context.__magpieCatalogSync.status().services[0].state).toBe('ready')
  expect(s.store.state.featureModelConfigs.composer.defaultModel).toBe('magpie-0')
})

test('model-catalog ignores a superseded failure after a newer refresh succeeded', async () => {
  const vm = runtime(), s = service(), old = deferred<any>()
  s.respond(() => old.promise); vm.register(s); await settle()
  s.respond(() => response()); vm.emit('refresh'); await settle()
  old.reject(new Error('old failure')); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  expect(vm.context.__magpieCatalogSync.status().services[0].state).toBe('ready')
})

test('model-catalog failure retains the last snapshot, exposes safe status and can retry', async () => {
  const vm = runtime(), s = service()
  s.respond(() => { throw new Error('secret must not appear in status') })
  vm.register(s); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(46)
  expect(vm.context.__magpieCatalogSync.status().services[0].state).toBe('fetch-or-apply-failed')
  expect(JSON.stringify(vm.context.__magpieCatalogSync.status())).not.toContain('secret')
  s.respond(() => response()); vm.emit('refresh'); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  s.respond(() => ({})); vm.emit('refresh'); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(58)
  s.respond(() => response(59)); vm.emit('refresh'); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(59)
})

test('model-catalog rolls back a partial persistence failure and retries without mixing snapshot versions', async () => {
  const vm = runtime(), s = service()
  vm.register(s); await settle()
  const baseline = structuredClone(s.store.state), persist = s.instance.persistFeatureModelConfigs
  s.instance.persistFeatureModelConfigs = () => { throw new Error('failed feature write') }
  s.respond(() => response(60, 'new')); vm.emit('refresh'); await settle()
  expect(s.store.state).toEqual(baseline)
  expect(vm.context.__magpieCatalogSync.status().services[0].state).toBe('fetch-or-apply-failed')
  s.instance.persistFeatureModelConfigs = persist
  vm.emit('refresh'); await settle()
  expect(s.store.state.availableDefaultModels2).toHaveLength(60)
  expect(s.store.state.featureModelConfigs.composer.defaultModel).toBe('new-0')
})

test('model-catalog observes display-only/feature-only merges and restores missing baseline fields', async () => {
  const vm = runtime(), s = service()
  const baseline = structuredClone(s.store.state)
  vm.register(s); await settle()
  s.store.api.setApplicationUserPersistentStorage(keys[1], { hideRoutedModelView: false, obsolete: true })
  await settle()
  expect(s.store.state.modelPickerDisplayConfiguration.hideRoutedModelView).toBe(true)
  expect(s.store.state.modelPickerDisplayConfiguration.obsolete).toBeUndefined()
  s.store.api.setApplicationUserPersistentStorage(keys[2], { composer: { defaultModel: 'old' } })
  await settle()
  expect(s.store.state.featureModelConfigs.composer.defaultModel).toBe('magpie-0')
  vm.emit('routes', []); await settle()
  expect(s.store.state).toEqual(baseline)
})

test('model-catalog shared storage uses one observer and one baseline across multiple service instances', async () => {
  const vm = runtime(), shared = storage(), a = service(shared), b = service(shared)
  vm.register(a); await settle()
  b.respond(() => response(59, 'new'))
  vm.register(b); await settle()
  expect(shared.state.availableDefaultModels2).toHaveLength(59)
  expect(shared.observers.size).toBe(1)
  shared.api.setApplicationUserPersistentStorage(keys[0], rows(46)); await settle()
  expect(shared.state.availableDefaultModels2).toHaveLength(59)
  vm.emit('routes', []); await settle()
  expect(shared.state.availableDefaultModels2).toHaveLength(46)
  expect(shared.observers.size).toBe(0)
  expect(a.calls.native).toBe(1); expect(b.calls.native).toBe(1)
})

test('model-catalog converts parsed protobuf recursively with numeric enums, repeated/map/oneof and optional fields', async () => {
  class Message {
    name = 'magpie'; category = 2; nested: any; repeated: any[] = []; mapping: any = {}; choice: any = { case: undefined }; optional = undefined
    getType() { return { fields: { byMember: () => [
      { localName: 'name' }, { localName: 'category' }, { localName: 'nested' }, { localName: 'repeated', repeated: true },
      { localName: 'mapping', kind: 'map' }, { localName: 'choice', kind: 'oneof', findField: (key: string) => key === 'selected' }, { localName: 'optional' },
    ] } } }
    toJson() { throw new Error('Must not convert enums to JSON strings') }
  }
  const model = new Message(), child = new Message()
  model.nested = child; model.repeated = [child]; model.mapping = { a: child }; model.choice = { case: 'selected', value: child }
  const s = service(); s.respond(() => ({ ...response(), models: [model] }))
  const vm = runtime(true, s.instance); await settle()
  const plain = s.store.state.availableDefaultModels2[0]
  expect(plain.category).toBe(2)
  for (const item of [plain, plain.nested, plain.repeated[0], plain.mapping.a, plain.choice.value]) {
    expect(item.getType).toBeUndefined(); expect(item.category).toBe(2)
  }
  expect(plain.optional).toBeUndefined()
  expect(vm.context.__magpieCatalogSync.status().services).toHaveLength(1)
})

test('model-catalog upgrades a full 0.2.3 hook preserving payload/local-loop and is idempotent', () => {
  const f = fixture(); patch(f)
  const good = readFileSync(f.paths.glassJs, 'utf8'), old = oldHook(good)
  expect(isModelCatalogCompatible(old)).toBe(false)
  expect(isInjectPatched(old)).toBe(false)
  for (const file of [f.paths.workbenchJs, f.paths.glassJs]) writeFileSync(file, old)
  patch(f)
  expect(readFileSync(f.paths.glassJs, 'utf8')).toBe(good)
  expect(upgradeModelCatalogHook(old)).toBe(good)
  expect(upgradeModelCatalogHook(good)).toBe(good)
  expect(patchModelCatalogHook(payload(good))).toBe(payload(good))
  patch(f)
  expect(readFileSync(f.paths.glassJs, 'utf8')).toBe(good)
})

test('model-catalog rejects marker-only, corrupted, duplicate or misplaced helper before writing either renderer', () => {
  const f = fixture(); patch(f)
  const good = readFileSync(f.paths.glassJs, 'utf8'), old = oldHook(good)
  const helper = good.match(/\/\* MAGPIE-CATALOG-SYNC-1 \*\/[\s\S]*?\/\* MAGPIE-CATALOG-SYNC-END \*\//)![0]
  const before = readdirSync(join(f.paths.appRoot, 'out'))
  for (const broken of [
    good.replace('var records=new Map()', 'var records=null'),
    good.replace(helper, '/* MAGPIE-CATALOG-SYNC-1 *//* MAGPIE-CATALOG-SYNC-END */'),
    good.replace(helper, helper + helper),
    good.replace(helper, `if(false){${helper}}`),
    good.replace('globalThis.__magpieCatalogSync&&globalThis.__magpieCatalogSync.mode();', ''),
    good.replace('/* MAGPIE-CATALOG-SYNC-1 */', '/* MAGPIE-CATALOG-SYNC-9 */'),
  ]) {
    writeFileSync(f.paths.workbenchJs, old)
    writeFileSync(f.paths.glassJs, broken)
    expect(isModelCatalogCompatible(broken)).toBe(false)
    expect(isInjectPatched(broken)).toBe(false)
    expect(() => patch(f)).toThrow(/model-catalog|local-loop/)
    expect(readFileSync(f.paths.workbenchJs, 'utf8')).toBe(old)
    expect(readFileSync(f.paths.glassJs, 'utf8')).toBe(broken)
    expect(readdirSync(join(f.paths.appRoot, 'out'))).toEqual(before)
  }
})
