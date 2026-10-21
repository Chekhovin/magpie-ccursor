import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCursorFixture } from './fixtures/cursor'
import { cursorStatus, restoreSnapshot, setupCursor, snapshotTransaction } from '../src/setup'
import { createAutoSetup } from '../src/auto-setup'

const directories: string[] = []
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'magpie-setup-')); directories.push(root)
  const appRoot = join(root, 'cursor'), dataDir = join(root, 'data')
  return { root, appRoot, dataDir, ...await createCursorFixture(appRoot), log: () => {} }
}
async function manifest(dataDir: string) { return JSON.parse(await readFile(join(dataDir, 'patch-manifest.json'), 'utf8')) }

test('setup snapshots separate Agent network chunks, is quiet when ready, and restores all original files', async () => {
  const f = await fixture(), logs: string[] = []
  expect((await setupCursor({ ...f, log: m => logs.push(m) })).changed).toBe(true)
  expect(cursorStatus(f).ready).toBe(true)
  const first = await manifest(f.dataDir)
  expect(first).toMatchObject({ state: 'applied', appRoot: f.appRoot, version: '3.26.13' })
  const network = first.entries.find((e: any) => e.file === join(f.paths.agentHostDist, 'network.js'))
  expect(network.originalHash).not.toBe(network.patchedHash)
  const before = await readdir(f.dataDir)
  logs.length = 0
  expect((await setupCursor({ ...f, log: m => logs.push(m) })).changed).toBe(false)
  expect(logs).toEqual([])
  expect(await readdir(f.dataDir)).toEqual(before)
  await restoreSnapshot(f.dataDir)
  await restoreSnapshot(f.dataDir)
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
})

test('automatic setup reapplies a clean upgrade, preserves old backups and restores only the current version', async () => {
  const f = await fixture()
  let clock = 0
  const reconcile = createAutoSetup({ ...f, paths: undefined, now: () => clock, settleMs: 10, checkIntervalMs: 20 })
  await reconcile(); clock = 10; await reconcile()
  const old = await manifest(f.dataDir)
  const oldBackups = await Promise.all(old.entries.map((e: any) => readFile(e.backup, 'utf8')))
  const next = await createCursorFixture(f.appRoot, '3.27.0')
  await expect(restoreSnapshot(f.dataDir)).rejects.toThrow('Cursor changed version')
  clock = 40; await reconcile(); clock = 50; await reconcile()
  const current = await manifest(f.dataDir)
  expect(current.version).toBe('3.27.0')
  expect(current.entries[0].backup).not.toBe(old.entries[0].backup)
  expect(await Promise.all(old.entries.map((e: any) => readFile(e.backup, 'utf8')))).toEqual(oldBackups)
  expect((await readdir(f.dataDir)).some(name => name.startsWith('patch-history-'))).toBe(true)
  await restoreSnapshot(f.dataDir)
  for (const [file, source] of next.sources) expect(await readFile(file, 'utf8')).toBe(source)
})

for (const target of ['alwaysLocalMain', 'glassJs', 'alwaysLocalSingletonJs', 'agentHostMain', 'extensionHostJs'] as const) {
  test(`unknown partial patch in ${target} is refused even with a clean desktop renderer`, async () => {
    const f = await fixture()
    await writeFile(f.paths[target], target === 'extensionHostJs' ? 'if(!1){}' : 'globalThis.__byokUnknown=true;')
    const desktop = await readFile(f.paths.workbenchJs, 'utf8')
    await expect(setupCursor(f)).rejects.toThrow(/partial|incomplete/)
    expect(await readFile(f.paths.workbenchJs, 'utf8')).toBe(desktop)
    expect(await readdir(f.dataDir).catch(() => [])).toEqual([])
  })
}

test('current Cursor layouts without the legacy singleton still become ready', async () => {
  const f = await fixture()
  await rm(f.paths.alwaysLocalSingletonJs)
  const result = await setupCursor(f)
  expect(result.changed).toBe(true)
  expect(result.ready).toBe(true)
  expect((await manifest(f.dataDir)).entries.some((entry: any) => entry.file === f.paths.alwaysLocalSingletonJs)).toBe(false)
  await restoreSnapshot(f.dataDir)
  expect(cursorStatus(f).ready).toBe(false)
})

test('signature bypass is required for ready status', async () => {
  const f = await fixture()
  await setupCursor(f)
  await writeFile(f.paths.extensionHostJs, f.sources.get(f.paths.extensionHostJs)!)
  expect(cursorStatus(f).ready).toBe(false)
  await expect(setupCursor(f)).rejects.toThrow('incomplete')
})

test('mixed upgrade checksum mismatch is refused before backup or writes', async () => {
  const f = await fixture()
  await writeFile(f.paths.glassJs, `${f.sources.get(f.paths.glassJs)}\n// another version`)
  await expect(setupCursor(f)).rejects.toThrow('checksum mismatch')
  expect(await readdir(f.dataDir).catch(() => [])).toEqual([])
})

test('patch failure rolls back renderer and separate network chunks', async () => {
  const f = await fixture()
  await writeFile(f.paths.productJson, '{}')
  await writeFile(f.paths.alwaysLocalSingletonJs, 'import * as h from "http";import * as s from "https";logger.info("proxy-agent patches installed")')
  await expect(setupCursor(f)).rejects.toThrow('createRequire')
  expect((await manifest(f.dataDir)).state).toBe('rolled-back')
  for (const file of [f.paths.workbenchJs, f.paths.agentHostMain, join(f.paths.agentHostDist, 'network.js')])
    expect(await readFile(file, 'utf8')).toBe(f.sources.get(file)!)
})

test('backup failure never invokes patch action or replaces the previous snapshot', async () => {
  const f = await fixture()
  await setupCursor(f)
  const old = await readFile(join(f.dataDir, 'patch-manifest.json'), 'utf8')
  let invoked = false
  await expect(snapshotTransaction([f.paths.workbenchJs, join(f.root, 'missing.js')], f.dataDir, () => { invoked = true })).rejects.toThrow()
  expect(invoked).toBe(false)
  expect(await readFile(join(f.dataDir, 'patch-manifest.json'), 'utf8')).toBe(old)
})

test('damaged or interrupted snapshots block setup and restore without overwriting originals', async () => {
  for (const state of ['broken-json', 'applying', 'corrupt-backup']) {
    const f = await fixture()
    await setupCursor(f)
    const saved = await manifest(f.dataDir)
    await createCursorFixture(f.appRoot, '3.27.0')
    if (state === 'broken-json') await writeFile(join(f.dataDir, 'patch-manifest.json'), '{')
    else if (state === 'applying') await writeFile(join(f.dataDir, 'patch-manifest.json'), JSON.stringify({ ...saved, state }))
    else await writeFile(saved.entries[0].backup, 'damaged')
    const desktop = await readFile(f.paths.workbenchJs, 'utf8')
    await expect(setupCursor({ ...f, paths: undefined })).rejects.toThrow()
    await expect(restoreSnapshot(f.dataDir)).rejects.toThrow()
    expect(await readFile(f.paths.workbenchJs, 'utf8')).toBe(desktop)
  }
})

test('restore verifies every backup before writing even the first target', async () => {
  const f = await fixture()
  await setupCursor(f)
  const saved = await manifest(f.dataDir)
  const patched = await Promise.all(saved.entries.map((e: any) => readFile(e.file, 'utf8')))
  await writeFile(saved.entries.at(-1).backup, 'corrupt backup')
  await expect(restoreSnapshot(f.dataDir)).rejects.toThrow('Backup verification failed')
  expect(await Promise.all(saved.entries.map((e: any) => readFile(e.file, 'utf8')))).toEqual(patched)
})

test('failed automatic setup waits for target changes, including across restarts', async () => {
  const f = await fixture(), logs: string[] = []
  await writeFile(f.paths.productJson, '{}')
  await writeFile(f.paths.alwaysLocalMain, 'exports.activate=123')
  let clock = 0
  const options = { ...f, paths: undefined, now: () => clock, settleMs: 0, checkIntervalMs: 10, log: (m: string) => logs.push(m) }
  const reconcile = createAutoSetup(options)
  await reconcile()
  const first = await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')
  for (let i = 0; i < 8; i++) { clock += 100; await reconcile() }
  const restarted = createAutoSetup(options)
  await restarted()
  expect(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).toBe(first)
  expect(logs.filter(m => m.includes('Automatic Cursor setup failed'))).toHaveLength(1)
  await createCursorFixture(f.appRoot, '3.27.0')
  clock += 100
  await restarted()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('ready')
})

test('manual restore durably pauses automatic setup until manual setup enables it again', async () => {
  const f = await fixture(), logs: string[] = []
  let clock = 0
  const options = { ...f, paths: undefined, now: () => clock, settleMs: 0, checkIntervalMs: 10, log: (m: string) => logs.push(m) }
  const reconcile = createAutoSetup(options)
  await reconcile()
  await restoreSnapshot(f.dataDir)
  clock += 100; await reconcile()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('paused')
  expect((await manifest(f.dataDir)).state).toBe('restored')
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
  const restarted = createAutoSetup(options)
  await restarted()
  await createCursorFixture(f.appRoot, '3.27.0')
  clock += 100; await restarted()
  expect((await manifest(f.dataDir)).state).toBe('restored')
  expect(logs.filter(m => m.includes('paused after manual restore'))).toHaveLength(1)
  await setupCursor({ ...f, paths: undefined })
  clock += 100; await restarted()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('ready')
})

test('automatic and manual operations share a lock and retry once its owner releases it', async () => {
  const f = await fixture()
  await mkdir(f.dataDir)
  const lockPath = join(f.dataDir, 'patch.lock')
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token: 'another-operation' }))
  await expect(setupCursor(f)).rejects.toThrow('in progress')
  await expect(restoreSnapshot(f.dataDir)).rejects.toThrow('in progress')
  let clock = 0
  const reconcile = createAutoSetup({ ...f, now: () => clock, settleMs: 0, checkIntervalMs: 1 })
  await reconcile()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('failed')
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
  await rm(lockPath)
  clock++
  await reconcile()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('ready')
  await expect(readFile(lockPath)).rejects.toThrow()
})

test('upgrading plugin hooks retains clean originals and rolls failure back to the previous plugin', async () => {
  const f = await fixture()
  await setupCursor(f)
  const old = await manifest(f.dataDir)
  const files = old.entries.map((entry: any) => entry.file)
  const metadata = { appRoot: old.appRoot, version: old.version, packageHash: old.packageHash }
  const oldRenderer = await readFile(f.paths.workbenchJs, 'utf8')
  await expect(snapshotTransaction(files, f.dataDir, async () => {
    await writeFile(f.paths.workbenchJs, 'incomplete new plugin patch')
    throw new Error('upgrade failure')
  }, metadata, true)).rejects.toThrow('upgrade failure')
  expect(await manifest(f.dataDir)).toEqual(old)
  expect(await readFile(f.paths.workbenchJs, 'utf8')).toBe(oldRenderer)
  await snapshotTransaction(files, f.dataDir, async () => {
    await writeFile(f.paths.workbenchJs, oldRenderer + '\n// upgraded compatibility hooks')
  }, metadata, true)
  const upgraded = await manifest(f.dataDir)
  expect(upgraded.entries.map((entry: any) => [entry.file, entry.backup, entry.originalHash]))
    .toEqual(old.entries.map((entry: any) => [entry.file, entry.backup, entry.originalHash]))
  await restoreSnapshot(f.dataDir)
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
})

test('concurrent operations never reclaim an abandoned patch lock', async () => {
  const f = await fixture()
  await mkdir(f.dataDir)
  const lockPath = join(f.dataDir, 'patch.lock')
  const orphan = JSON.stringify({ pid: 2147483647, token: 'orphan' })
  await writeFile(lockPath, orphan)
  const results = await Promise.allSettled([setupCursor(f), setupCursor(f), restoreSnapshot(f.dataDir)])
  expect(results.every(result => result.status === 'rejected')).toBe(true)
  expect(await readFile(lockPath, 'utf8')).toBe(orphan)
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
})

test('an external version update during setup preserves updater files instead of rolling back over them', async () => {
  const f = await fixture()
  const packageFile = join(f.appRoot, 'package.json')
  const packageHash = createHash('sha256').update(await readFile(packageFile)).digest('hex')
  await expect(snapshotTransaction([f.paths.workbenchJs], f.dataDir, async () => {
    await writeFile(f.paths.workbenchJs, 'files written by the Cursor updater')
    await writeFile(packageFile, JSON.stringify({ version: '3.27.0' }))
    throw new Error('Cursor changed version during setup')
  }, { appRoot: f.appRoot, version: '3.26.13', packageHash })).rejects.toThrow('rollback was skipped')
  expect(await readFile(f.paths.workbenchJs, 'utf8')).toBe('files written by the Cursor updater')
  const saved = await manifest(f.dataDir)
  expect(saved.state).toBe('applying')
  expect(await readFile(saved.entries[0].backup, 'utf8')).toBe(f.sources.get(f.paths.workbenchJs)!)
  await expect(restoreSnapshot(f.dataDir)).rejects.toThrow('interrupted')
})

test('unwritable backup destination reports failure without touching Cursor', async () => {
  const f = await fixture(), logs: string[] = []
  await writeFile(f.dataDir, 'a file blocks creation of the backup directory')
  const reconcile = createAutoSetup({ ...f, settleMs: 0, log: m => logs.push(m) })
  await reconcile()
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
  expect(logs.some(m => m.includes('Automatic Cursor setup failed'))).toBe(true)
  expect(logs.some(m => m.includes('Cannot write automatic Cursor setup status'))).toBe(true)
})
