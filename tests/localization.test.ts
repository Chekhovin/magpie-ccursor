import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createCursorFixture } from './fixtures/cursor'
import { setupCursor, restoreSnapshot, cursorStatus } from '../src/setup'
import { createAutoSetup } from '../src/auto-setup'
import { localizationHash, planLocalization, transformLocalization, validateLocalizationCatalog, type LocalizationCatalog } from '../src/localization'
import { readLocalizationOption, saveLocalizationOption, localizationOption } from '../src/plugin-options'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture(legacy = false) {
  const root = await mkdtemp(join(tmpdir(), 'magpie-localization-')); dirs.push(root)
  const appRoot = join(root, 'cursor'), dataDir = join(root, 'data')
  const f = await createCursorFixture(appRoot, '3.27.22')
  const files: LocalizationCatalog['files'] = []
  for (const target of [f.paths.workbenchJs, f.paths.glassJs]) {
    const en = Buffer.from(f.sources.get(target)! + '\nconst label="New chat";const dragType="Files";')
    const safe = Buffer.from(en.toString().replace('New chat', '新建对话'))
    const old = Buffer.from(safe.toString().replace('"Files"', '"文件"'))
    const first = en.indexOf('New chat'), second = en.indexOf('Files'), delta = Buffer.byteLength('新建对话') - Buffer.byteLength('New chat')
    files.push({ file: relative(appRoot, target).replaceAll('\\', '/'), sourceSha256: localizationHash(en),
      legacySha256: localizationHash(old), localizedSha256: localizationHash(safe), replacements: [
        { sourceByteOffset: first, targetByteOffset: first, localizedByteOffset: first, before: 'New chat', after: '新建对话' },
        { sourceByteOffset: second, targetByteOffset: second + delta, localizedByteOffset: second + delta, before: 'Files', after: '文件', excluded: 'protocol-type' },
      ] })
    const initial = legacy ? old.toString() : en.toString()
    await writeFile(target, initial); f.sources.set(target, initial)
  }
  const product = JSON.parse(f.sources.get(f.paths.productJson)!)
  for (const target of [f.paths.workbenchJs, f.paths.glassJs])
    product.checksums[relative(join(appRoot, 'out'), target).replaceAll('\\', '/')] = createHash('sha256').update(f.sources.get(target)!).digest('base64').replace(/=+$/, '')
  const initialProduct = JSON.stringify(product)
  await writeFile(f.paths.productJson, initialProduct); f.sources.set(f.paths.productJson, initialProduct)
  const localizationCatalog: LocalizationCatalog = { schemaVersion: 1, revision: 'fixture-1', cursorVersion: '3.27.22', files }
  return { ...f, appRoot, dataDir, localizationCatalog, log: () => {} }
}
const snapshot = async (dir: string) => JSON.parse(await readFile(join(dir, 'patch-manifest.json'), 'utf8'))

for (const legacy of [false, true]) test(`localized=${legacy} baseline supports ON/OFF/ON while preserving original backups and model hooks`, async () => {
  const f = await fixture(legacy)
  const on = await setupCursor(f)
  expect(on.localization?.state).toBe('enabled'); expect(on.ready).toBe(true)
  const first = await snapshot(f.dataDir)
  for (const file of [f.paths.workbenchJs, f.paths.glassJs]) {
    const source = await readFile(file, 'utf8')
    expect(source).toContain('新建对话'); expect(source).toContain('dragType="Files"')
    expect(source).not.toContain('dragType="文件"')
    expect(source).toContain('input[placeholder="搜索模型"]')
  }
  expect((await setupCursor(f)).changed).toBe(false)
  const off = await setupCursor({ ...f, localize: false })
  expect(off.ready).toBe(true); expect(off.localization?.state).toBe('disabled')
  for (const file of [f.paths.workbenchJs, f.paths.glassJs]) {
    const source = await readFile(file, 'utf8')
    expect(source).toContain('New chat'); expect(source).not.toContain('新建对话')
    expect(source).toContain('input[placeholder="Search models"]')
  }
  expect((await setupCursor({ ...f, localize: false })).changed).toBe(false)
  expect((await setupCursor(f)).ready).toBe(true)
  const final = await snapshot(f.dataDir)
  expect(final.entries.map((e: any) => [e.backup, e.originalHash])).toEqual(first.entries.map((e: any) => [e.backup, e.originalHash]))
  const product = JSON.parse(await readFile(f.paths.productJson, 'utf8'))
  for (const file of [f.paths.workbenchJs, f.paths.glassJs]) {
    const key = relative(join(f.appRoot, 'out'), file).replaceAll('\\', '/')
    expect(product.checksums[key]).toBe(createHash('sha256').update(await readFile(file)).digest('base64').replace(/=+$/, ''))
  }
  await restoreSnapshot(f.dataDir)
  for (const [file, original] of f.sources) expect(await readFile(file, 'utf8')).toBe(original)
})

test('fresh OFF installs only hooks; unknown build skips translation and keeps routing', async () => {
  const f = await fixture()
  expect((await setupCursor({ ...f, localize: false })).ready).toBe(true)
  expect(await readFile(f.paths.workbenchJs, 'utf8')).toContain('New chat')
  await restoreSnapshot(f.dataDir)
  const result = await setupCursor({ ...f, localizationCatalog: { ...f.localizationCatalog, cursorVersion: '3.28.0' } })
  expect(result.ready).toBe(true); expect(result.localization?.state).toBe('unsupported')
  expect(await readFile(f.paths.workbenchJs, 'utf8')).not.toContain('新建对话')
})

test('unknown or externally changed baseline never partly translates or overwrites recorded targets', async () => {
  const f = await fixture()
  const sources = new Map(f.localizationCatalog.files.map(file => [file.file, Buffer.from(f.sources.get(join(f.appRoot, file.file))!)]))
  sources.set(f.localizationCatalog.files[1].file, Buffer.from('unrecognized'))
  const plan = planLocalization('3.27.22', sources, true, f.localizationCatalog)
  expect(plan.record.state).toBe('unsupported'); expect(plan.outputs.size).toBe(0)
  await setupCursor(f)
  const manifest = await readFile(join(f.dataDir, 'patch-manifest.json'), 'utf8')
  const before = await readFile(f.paths.workbenchJs, 'utf8')
  await writeFile(f.paths.glassJs, 'external change')
  await expect(setupCursor({ ...f, localize: false })).rejects.toThrow()
  expect(await readFile(f.paths.workbenchJs, 'utf8')).toBe(before)
  expect(await readFile(f.paths.glassJs, 'utf8')).toBe('external change')
  expect(await readFile(join(f.dataDir, 'patch-manifest.json'), 'utf8')).toBe(manifest)
})

test('same preference cannot confirm localization after an external text change with intact hooks', async () => {
  const f = await fixture()
  await setupCursor(f)
  const path = join(f.dataDir, 'patch-manifest.json'), previous = await readFile(path, 'utf8')
  const changed = (await readFile(f.paths.workbenchJs, 'utf8')).replace('新建对话', 'New chat')
  await writeFile(f.paths.workbenchJs, changed)
  expect(cursorStatus(f).ready).toBe(true)
  await expect(setupCursor(f)).rejects.toThrow('changed outside')
  expect(await readFile(f.paths.workbenchJs, 'utf8')).toBe(changed)
  expect(await readFile(path, 'utf8')).toBe(previous)
})

test('malformed catalog and output hash fail before any live writes', async () => {
  const f = await fixture()
  const file = f.localizationCatalog.files[0], source = Buffer.from(f.sources.get(f.paths.workbenchJs)!)
  expect(() => validateLocalizationCatalog({ ...f.localizationCatalog, files: [{ ...file, file: '../escape.js' }] })).toThrow()
  expect(() => validateLocalizationCatalog({ ...f.localizationCatalog, files: [{ ...file, replacements: [file.replacements[1], file.replacements[0]] }] })).toThrow()
  expect(() => transformLocalization(source, { ...file, localizedSha256: '0'.repeat(64) }, true)).toThrow('hash')
  const catalog = structuredClone(f.localizationCatalog); catalog.files[1].localizedSha256 = '0'.repeat(64)
  await expect(setupCursor({ ...f, localizationCatalog: catalog })).rejects.toThrow('hash')
  for (const [target, text] of f.sources) expect(await readFile(target, 'utf8')).toBe(text)
})

test('saved OFF survives host restart; missing options default ON and invalid values do not enable silently', async () => {
  const f = await fixture()
  expect(await readLocalizationOption(f.dataDir)).toBe(true)
  expect(localizationOption({ localize: false })).toBe(false)
  expect(() => localizationOption({ localize: 'false' })).toThrow()
  await saveLocalizationOption(f.dataDir, { localize: false })
  expect(await readLocalizationOption(f.dataDir)).toBe(false)
  expect((await setupCursor(f)).localization?.state).toBe('disabled')
  await writeFile(join(f.dataDir, 'plugin-options.json'), '{bad')
  await expect(readLocalizationOption(f.dataDir)).rejects.toThrow()
})

test('preference changes bypass the long polling interval; restore intent remains paused', async () => {
  const f = await fixture(); let time = 1000, localize = true
  const reconcile = createAutoSetup({ ...f, now: () => time, getLocalize: () => localize, settleMs: 0, checkIntervalMs: 30000 })
  await reconcile()
  localize = false; time += 1; await reconcile()
  expect((await snapshot(f.dataDir)).localization.state).toBe('disabled')
  expect(cursorStatus(f).ready).toBe(true)
  await restoreSnapshot(f.dataDir)
  localize = true; time += 1; await reconcile()
  expect((await snapshot(f.dataDir)).state).toBe('restored')
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('paused')
})
