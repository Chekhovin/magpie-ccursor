import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createCursorFixture } from './fixtures/cursor'
import { setupCursor, cursorStatus, restoreSnapshot, snapshotTransaction } from '../src/setup'
import { createAutoSetup } from '../src/auto-setup'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function oldSnapshot() {
  const root = await mkdtemp(join(tmpdir(), 'magpie-upgrade-026-')); dirs.push(root)
  const appRoot = join(root, 'cursor'), dataDir = join(root, 'data')
  const fixture = await createCursorFixture(appRoot, '3.27.22')
  const f = { ...fixture, root, appRoot, dataDir, log: () => {} }
  await setupCursor(f)
  const manifest = JSON.parse(await readFile(join(dataDir, 'patch-manifest.json'), 'utf8'))
  const oldHook = await readFile(join(import.meta.dir, 'fixtures/upstream-installer-026-hook.js'), 'utf8')
  const oldRouter = await readFile(join(import.meta.dir, 'fixtures/upstream-installer-026-router.js'), 'utf8')
  const paths = f.paths
  // Recorded 0.2.6 hooks: preserve the unchanged helper/call-site and replace only known payloads.
  await snapshotTransaction(manifest.entries.map((e: any) => e.file), dataDir, () => {
    for (const file of [paths.workbenchJs, paths.glassJs]) {
      const source = readFileSync(file, 'utf8')
      writeFileSync(file, '/* CURSOR-BYOK-HOOK-START */' + oldHook + source.slice(source.indexOf('/* CURSOR-BYOK-HOOK-END */')))
    }
    for (const [file, label, marker] of [[paths.agentHostMain, 'agent-host', '__byokAgentHostUrlRewrite'], [paths.alwaysLocalMain, 'always-local', '__byokUrlRewrite']]) {
      const current = readFileSync(file, 'utf8').replace(/\/\* (BYOK-HTTP11-ROUTER-V\d+) \*\/[\s\S]*?\/\* \1-END \*\/\r?\n?/g, '')
      writeFileSync(file, oldRouter.replaceAll('__byokAgentHostUrlRewrite', marker).replace('PROCESS_LABEL="agent-host"', `PROCESS_LABEL="${label}"`) + current)
    }
    const product = JSON.parse(readFileSync(paths.productJson, 'utf8'))
    for (const key of Object.keys(product.checksums)) {
      const file = join(appRoot, 'out', key)
      product.checksums[key] = createHash('sha256').update(readFileSync(file)).digest('base64').replace(/=+$/, '')
    }
    writeFileSync(paths.productJson, JSON.stringify(product))
  }, { appRoot, version: manifest.version, packageHash: manifest.packageHash }, true)
  return { ...f, original: manifest }
}

test('automatic 0.2.6 upgrade refreshes renderer and Node routing while retaining pristine backups', async () => {
  const f = await oldSnapshot()
  const before = cursorStatus(f)
  expect(before.renderer).toBe(false); expect(before.agent).toBe(false); expect(before.alwaysLocal).toBe(false)
  await createAutoSetup({ ...f, settleMs: 0 })()
  expect(cursorStatus(f).ready).toBe(true)
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('ready')
  const updated = JSON.parse(await readFile(join(f.dataDir, 'patch-manifest.json'), 'utf8'))
  expect(updated.entries.map((e: any) => [e.file, e.backup, e.originalHash]))
    .toEqual(f.original.entries.map((e: any) => [e.file, e.backup, e.originalHash]))
  expect((await setupCursor(f)).changed).toBe(false)
  await restoreSnapshot(f.dataDir)
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
})

test('failed multi-component upgrade restores the recorded previous hooks and snapshot', async () => {
  const f = await oldSnapshot()
  const saved = JSON.parse(await readFile(join(f.dataDir, 'patch-manifest.json'), 'utf8'))
  // An intact recorded old hook can still have an unsupported new turn layout.
  const file = join(f.paths.agentHostDist, 'network.js')
  const broken = (await readFile(file, 'utf8')) + ';var newLayout=["local-loop-turn-router","managed-local"];'
  await writeFile(file, broken)
  saved.entries.find((e: any) => e.file === file).patchedHash = createHash('sha256').update(broken).digest('hex')
  await writeFile(join(f.dataDir, 'patch-manifest.json'), JSON.stringify(saved))
  const oldBytes = await Promise.all(saved.entries.map((e: any) => readFile(e.file, 'utf8')))
  await expect(setupCursor(f)).rejects.toThrow(/turn route|turn-route|turn router/i)
  expect(await Promise.all(saved.entries.map((e: any) => readFile(e.file, 'utf8')))).toEqual(oldBytes)
  expect(JSON.parse(await readFile(join(f.dataDir, 'patch-manifest.json'), 'utf8'))).toEqual(saved)
})
