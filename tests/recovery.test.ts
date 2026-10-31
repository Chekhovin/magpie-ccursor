import { afterEach, expect, test } from 'bun:test'
import { readFile, writeFile, mkdtemp, readdir, rm, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { cursorStatus, setupCursor, restoreSnapshot, snapshotTransaction } from '../src/setup'
import { createAutoSetup } from '../src/auto-setup'
import { patchGuardPort } from '../src/patch-lock'
import { createCursorFixture, sandboxEnvironment } from './fixtures/cursor'

const dirs: string[] = []
const children: { child: ReturnType<typeof spawn>, exit: Promise<number | null> }[] = []
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
const manifestPath = (dir: string) => join(dir, 'patch-manifest.json')
const manifest = async (dir: string) => JSON.parse(await readFile(manifestPath(dir), 'utf8'))
afterEach(async () => {
  for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await Promise.all(children.splice(0).map(c => c.exit))
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'magpie-recovery-')); dirs.push(root)
  const appRoot = join(root, 'cursor'), dataDir = join(root, '.magpie-ccursor')
  return { root, appRoot, dataDir, ...await createCursorFixture(appRoot, '3.27.22'), log: () => {} }
}
async function interruptedFixture() {
  const f = await fixture()
  await setupCursor(f)
  const saved = await manifest(f.dataDir)
  await restoreSnapshot(f.dataDir)
  const interrupted = { ...saved, state: 'applying', entries: saved.entries.map((e: any) => ({ ...e, patchedHash: '' })) }
  await writeFile(manifestPath(f.dataDir), JSON.stringify(interrupted))
  return { ...f, interrupted }
}
async function startPaused(f: Awaited<ReturnType<typeof fixture>>, state: 'applying' | 'restoring' | 'restoring-after-copy', change = false) {
  const child = spawn(process.execPath, ['--preload', fileURLToPath(new URL('./fixtures/pause-patch-manifest.ts', import.meta.url)),
    fileURLToPath(new URL('../cli.ts', import.meta.url)), state === 'applying' ? 'setup' : 'restore', '--cursor-closed'], {
    env: { ...sandboxEnvironment(f.root), PATCH_TEST_PAUSE_STATE: state, PATCH_TEST_CHANGE_TARGET: change ? '1' : '0' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = '', errors = ''
  child.stderr!.on('data', b => { errors += String(b) })
  child.stdin!.on('error', () => {})
  const exit = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
  children.push({ child, exit })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No paused manifest: ${errors}`)), 10000)
    child.stdout!.on('data', b => {
      output += String(b)
      if (output.includes('MANIFEST_PAUSED')) { clearTimeout(timer); resolve() }
    })
    exit.then(code => { clearTimeout(timer); reject(new Error(`Exited before pause (${code}): ${errors}`)) }, reject)
  })
  return { child, exit }
}

test('a killed setup owner recovers automatically, preserves evidence, then restores the current originals', async () => {
  const f = await fixture()
  const running = await startPaused(f, 'applying')
  const interrupted = await manifest(f.dataDir)
  expect(interrupted.state).toBe('applying')
  expect(JSON.parse(await readFile(join(f.dataDir, 'patch.lock'), 'utf8')).pid).toBe(running.child.pid)
  running.child.kill('SIGKILL'); await running.exit
  const reconcile = createAutoSetup({ ...f, settleMs: 0 })
  await reconcile()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('ready')
  expect(cursorStatus(f).ready).toBe(true)
  expect((await manifest(f.dataDir)).state).toBe('applied')
  const histories = await Promise.all((await readdir(f.dataDir)).filter(n => n.startsWith('patch-history-')).map(n => readFile(join(f.dataDir, n), 'utf8')))
  expect(histories.some(s => JSON.stringify(JSON.parse(s)) === JSON.stringify(interrupted))).toBe(true)
  for (const e of interrupted.entries) expect(hash(await readFile(e.backup))).toBe(e.originalHash)
  await expect(readFile(join(f.dataDir, 'patch.lock'))).rejects.toThrow()
  await restoreSnapshot(f.dataDir)
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
}, 15000)

test('a killed setup after a target change stays blocked and never rewrites other targets', async () => {
  const f = await fixture()
  const running = await startPaused(f, 'applying', true)
  running.child.kill('SIGKILL'); await running.exit
  const saved = await readFile(manifestPath(f.dataDir), 'utf8')
  const before = await Promise.all([...f.sources.keys()].map(file => readFile(file, 'utf8')))
  await createAutoSetup({ ...f, settleMs: 0 })()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('failed')
  expect(await readFile(manifestPath(f.dataDir), 'utf8')).toBe(saved)
  expect(await Promise.all([...f.sources.keys()].map(file => readFile(file, 'utf8')))).toEqual(before)
}, 15000)

for (const pauseState of ['restoring', 'restoring-after-copy'] as const) {
  test(`killed restore at ${pauseState} persists intent, stays paused, and resumes explicitly`, async () => {
    const f = await fixture()
    await setupCursor(f)
    const running = await startPaused(f, pauseState)
    running.child.kill('SIGKILL'); await running.exit
    const saved = await manifest(f.dataDir)
    expect(saved.state).toBe('restoring')
    if (pauseState === 'restoring-after-copy') {
      const changed = saved.entries.filter((e: any) => e.originalHash !== e.patchedHash)
      const current = await Promise.all(changed.map(async (e: any) => hash(await readFile(e.file))))
      expect(current.some((h, i) => h === changed[i].originalHash)).toBe(true)
      expect(current.some((h, i) => h === changed[i].patchedHash)).toBe(true)
    }
    await createAutoSetup({ ...f, settleMs: 0 })()
    expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('paused')
    await expect(setupCursor(f)).rejects.toThrow('Restore was interrupted')
    await restoreSnapshot(f.dataDir)
    expect((await manifest(f.dataDir)).state).toBe('restored')
    for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
  }, 15000)
}

test('explicit restore of a clean interrupted setup records restored intent rather than retrying setup', async () => {
  const f = await interruptedFixture()
  await restoreSnapshot(f.dataDir)
  expect((await manifest(f.dataDir)).state).toBe('restored')
  await createAutoSetup({ ...f, settleMs: 0 })()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('paused')
  expect(cursorStatus(f).ready).toBe(false)
})

for (const restart of [false, true]) {
  test(`guard contention retries with unchanged files${restart ? ' after daemon restart' : ''}`, async () => {
    const f = await fixture()
    await mkdir(f.dataDir)
    const blocker = createServer(socket => socket.destroy())
    const port = await patchGuardPort(f.dataDir)
    await new Promise<void>(resolve => blocker.listen({ host: '127.0.0.1', port, exclusive: true }, resolve))
    let clock = 0
    const options = { ...f, now: () => clock, settleMs: 0, checkIntervalMs: 10 }
    let reconcile = createAutoSetup(options)
    let waiting: any
    try {
      await reconcile()
      waiting = JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8'))
      expect(waiting.state).toBe('waiting')
      expect(await readdir(f.dataDir)).toEqual(['auto-setup.json'])
      if (restart) {
        reconcile = createAutoSetup(options)
        clock += 10; await reconcile()
        expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('waiting')
      }
    } finally { await new Promise<void>(resolve => blocker.close(() => resolve())) }
    // Releasing the kernel guard changes no fingerprinted target or file-lock metadata.
    expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).fingerprint).toBe(waiting.fingerprint)
    clock += 10; await reconcile()
    expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('ready')
  })
}

test('manual restore winning before automatic lock acquisition stays paused', async () => {
  const f = await fixture()
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/pause-before-lock.ts', import.meta.url))], {
    env: { ...sandboxEnvironment(f.root), PATCH_TEST_DATA: f.dataDir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = '', errors = ''
  child.stderr!.on('data', b => { errors += String(b) })
  child.stdin!.on('error', () => {})
  const exit = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
  children.push({ child, exit })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No pre-lock signal: ${errors}`)), 10000)
    child.stdout!.on('data', b => { output += String(b); if (output.includes('BEFORE_GUARD')) { clearTimeout(timer); resolve() } })
    exit.then(code => { clearTimeout(timer); reject(new Error(`Child exited early: ${code} ${errors}`)) }, reject)
  })
  // Automatic setup already checked the old snapshot. An explicit operation wins the guard.
  await setupCursor(f)
  await restoreSnapshot(f.dataDir)
  const before = await readFile(manifestPath(f.dataDir), 'utf8')
  child.stdin!.end('continue\n')
  expect(await exit).toBe(0)
  expect(output).toContain('AutomaticSetupPausedError')
  expect(output).not.toContain('SETUP_COMPLETED')
  expect(await readFile(manifestPath(f.dataDir), 'utf8')).toBe(before)
  for (const [file, source] of f.sources) expect(await readFile(file, 'utf8')).toBe(source)
}, 15000)

for (const glassState of ['no-checksum', 'bad-checksum', 'changed-target']) {
  test(`real-layout recovery handles Glass ${glassState} without bypassing file verification`, async () => {
    const f = await interruptedFixture()
    const productEntry = f.interrupted.entries.find((e: any) => e.file === f.paths.productJson)
    const product = JSON.parse(await readFile(productEntry.file, 'utf8'))
    const glassKey = Object.keys(product.checksums).find(key => key.endsWith('workbench.glass.main.js'))!
    if (glassState === 'bad-checksum') product.checksums[glassKey] = 'incorrect-checksum'
    else delete product.checksums[glassKey]
    const bytes = JSON.stringify(product)
    await writeFile(productEntry.file, bytes); await writeFile(productEntry.backup, bytes)
    productEntry.originalHash = hash(bytes)
    await writeFile(manifestPath(f.dataDir), JSON.stringify(f.interrupted))
    if (glassState === 'changed-target') await writeFile(f.paths.glassJs, 'different Glass bytes')
    if (glassState !== 'no-checksum') {
      const before = await readFile(f.paths.glassJs, 'utf8')
      await expect(setupCursor(f)).rejects.toThrow(glassState === 'bad-checksum' ? 'checksum mismatch' : 'changed files')
      expect(await readFile(f.paths.glassJs, 'utf8')).toBe(before)
      expect((await manifest(f.dataDir)).state).toBe('applying')
    } else {
      expect((await setupCursor(f)).ready).toBe(true)
      await restoreSnapshot(f.dataDir)
      expect(await readFile(f.paths.productJson, 'utf8')).toBe(bytes)
    }
  })
}

for (const kind of ['backup', 'target', 'duplicate', 'missing-entry', 'new-chunk', 'version', 'checksums']) {
  test(`automatic recovery refuses ${kind} mismatch before target writes`, async () => {
    const f = await interruptedFixture(), saved = f.interrupted
    if (kind === 'backup') await writeFile(saved.entries[0].backup, 'corrupt')
    if (kind === 'target') await writeFile(saved.entries[1].file, 'unrecorded change')
    if (kind === 'duplicate') saved.entries.push(saved.entries[0])
    if (kind === 'missing-entry') saved.entries.pop()
    if (kind === 'new-chunk') await writeFile(join(f.paths.agentHostDist, 'new-version.js'), 'new chunk')
    if (kind === 'version') await writeFile(join(f.appRoot, 'package.json'), JSON.stringify({ version: '3.28.0' }))
    if (kind === 'checksums') {
      const product = saved.entries.find((e: any) => e.file === f.paths.productJson)
      await writeFile(product.file, '{}'); await writeFile(product.backup, '{}'); product.originalHash = hash('{}')
    }
    await writeFile(manifestPath(f.dataDir), JSON.stringify(saved))
    const baseline = await readFile(manifestPath(f.dataDir), 'utf8')
    const targets = await Promise.all([...f.sources.keys()].map(file => readFile(file, 'utf8')))
    await expect(setupCursor({ ...f, paths: undefined })).rejects.toThrow()
    expect(await readFile(manifestPath(f.dataDir), 'utf8')).toBe(baseline)
    expect(await Promise.all([...f.sources.keys()].map(file => readFile(file, 'utf8')))).toEqual(targets)
  })
}

test('old patched files backed up by an interrupted compatibility upgrade are not treated as clean originals', async () => {
  const f = await fixture(); await setupCursor(f)
  const saved = await manifest(f.dataDir)
  let interrupted = ''
  await expect(snapshotTransaction(saved.entries.map((e: any) => e.file), f.dataDir, async () => {
    interrupted = await readFile(manifestPath(f.dataDir), 'utf8')
    throw new Error('pause fixture')
  }, { appRoot: saved.appRoot, version: saved.version, packageHash: saved.packageHash }, true)).rejects.toThrow('pause fixture')
  await writeFile(manifestPath(f.dataDir), interrupted)
  const before = await Promise.all([...f.sources.keys()].map(file => readFile(file, 'utf8')))
  await expect(setupCursor(f)).rejects.toThrow(/incomplete|partial/)
  expect(await readFile(manifestPath(f.dataDir), 'utf8')).toBe(interrupted)
  expect(await Promise.all([...f.sources.keys()].map(file => readFile(file, 'utf8')))).toEqual(before)
})

test('an interrupted clean snapshot cached as a 0.2.5 failure receives a new recovery attempt', async () => {
  const f = await interruptedFixture()
  await writeFile(join(f.dataDir, 'auto-setup.json'), JSON.stringify({ state: 'failed', fingerprint: '["renderer-model-catalog-v1","old target"]', message: 'Setup was interrupted' }))
  await createAutoSetup({ ...f, settleMs: 0 })()
  expect(JSON.parse(await readFile(join(f.dataDir, 'auto-setup.json'), 'utf8')).state).toBe('ready')
})
