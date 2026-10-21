import { afterEach, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile, mkdir, utimes } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from '../agent.mjs'
import { createCursorFixture, sandboxEnvironment } from './fixtures/cursor'

const children: ReturnType<typeof launch>[] = []
const dirs: string[] = []
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 12000
  do { if (await check()) return; await sleep(100) } while (Date.now() < deadline)
  throw new Error(`${message}\n${children.map(c => c.logs()).join('\n')}`)
}
async function freePort() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}
function launch(dir: string, port: number, autoSetup = false, slowBackup = false) {
  const preload = slowBackup ? ['--preload', fileURLToPath(new URL('./fixtures/slow-backup.ts', import.meta.url))] : []
  const child = spawn(process.execPath, [...preload, fileURLToPath(new URL('../src/daemon.ts', import.meta.url)), '--managed', dir, String(port)], {
    env: { ...sandboxEnvironment(dir), MAGPIE_CCURSOR_SKIP_AUTO_SETUP: autoSetup ? '0' : '1' },
    stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  let logs = ''
  child.stderr.on('data', d => { logs += String(d) })
  const exit = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
  return { child, exit, logs: () => logs }
}
afterEach(async () => {
  for (const { child } of children) child.stdin.end()
  await Promise.all(children.map(async ({ child, exit }) => {
    const timer = setTimeout(() => child.kill(), 6000)
    try { await exit } finally { clearTimeout(timer) }
  }))
  children.length = 0
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

test('managed daemon connects, hands over, disconnects and exits with its parent pipe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'magpie-ccursor-daemon-')); dirs.push(root)
  const dir = join(root, 'isolated'); await mkdir(dir)
  const port = await freePort(), url = `http://127.0.0.1:${port}`
  const connection = connect({ gateway: { v1: 'http://127.0.0.1:1/v1', key: 'fixture-only' }, models: [{ id: 'fixture/one', name: 'One' }] })
  await writeFile(join(dir, 'connection.json'), JSON.stringify(connection))
  await writeFile(join(dir, 'bridge.lock'), '')
  await utimes(join(dir, 'bridge.lock'), new Date(0), new Date(0))
  const first = launch(dir, port); children.push(first)
  async function health() { try { return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(300) }).then(r => r.json()) as any).magpieCcursor === true } catch { return false } }
  await until(health, 'first bridge did not start')
  expect(first.logs()).not.toContain('fixture-only')
  const second = launch(dir, port); children.push(second)
  first.child.stdin.end()
  expect(await first.exit).toBe(0)
  await until(async () => (await readFile(join(dir, 'bridge.lock'), 'utf8').catch(() => '')) === String(second.child.pid) && await health(), 'second bridge did not take ownership')
  await writeFile(join(dir, 'connection.json'), JSON.stringify({ enabled: false }))
  await until(async () => !(await health()), 'disconnected bridge remained online')
  await until(async () => JSON.parse(await readFile(join(dir, 'providers.json'), 'utf8')).providers.length === 0, 'disconnected credentials were not cleared')
  await writeFile(join(dir, 'connection.json'), JSON.stringify(connection))
  await until(health, 'bridge did not reconnect')
  await writeFile(join(dir, 'connection.json'), '{broken')
  await until(async () => !(await health()), 'malformed config did not stop the bridge')
  second.child.stdin.end()
  expect(await second.exit).toBe(0)
}, 45000)

test('daemon installs Cursor hooks without Agent configuration and keeps one snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-auto-daemon-')); dirs.push(dir)
  const { paths } = await createCursorFixture(join(dir, 'cursor'))
  const running = launch(dir, await freePort(), true); children.push(running)
  const statusFile = join(dir, 'auto-setup.json')
  await until(async () => JSON.parse(await readFile(statusFile, 'utf8').catch(() => '{}')).state === 'ready', 'automatic setup did not complete')
  expect(await readFile(paths.workbenchJs, 'utf8')).toContain('CURSOR-BYOK-HOOK-START')
  expect(await readFile(join(paths.agentHostDist, 'network.js'), 'utf8')).toContain('__byokAgentWebSocketGateDisabled')
  expect(JSON.parse(await readFile(statusFile, 'utf8')).restartRequired).toBe(true)
  const manifest = await readFile(join(dir, 'patch-manifest.json'), 'utf8')
  await sleep(2200)
  expect(await readFile(join(dir, 'patch-manifest.json'), 'utf8')).toBe(manifest)
  expect(running.logs().match(/Cursor hooks installed/g)).toHaveLength(1)
  expect(running.child.exitCode).toBeNull()
}, 15000)

test('parent exit during a slow backup lets the patch transaction finish and release its locks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-auto-shutdown-')); dirs.push(dir)
  const { paths } = await createCursorFixture(join(dir, 'cursor'))
  const running = launch(dir, await freePort(), true, true); children.push(running)
  await until(async () => !!await readFile(join(dir, 'patch.lock'), 'utf8').catch(() => ''), 'setup never acquired patch lock')
  const started = Date.now()
  running.child.stdin.end()
  expect(await running.exit).toBe(0)
  expect(Date.now() - started).toBeGreaterThan(4000)
  expect(JSON.parse(await readFile(join(dir, 'patch-manifest.json'), 'utf8')).state).toBe('applied')
  expect(await readFile(paths.workbenchJs, 'utf8')).toContain('__magpieCcursorConnectMode')
  await expect(readFile(join(dir, 'patch.lock'))).rejects.toThrow()
  await expect(readFile(join(dir, 'bridge.lock'))).rejects.toThrow()
}, 20000)

for (const failure of ['missing Cursor', 'patch failure']) {
  test(`daemon keeps bridge running after ${failure} and does not retry each tick`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'magpie-auto-failure-')); dirs.push(dir)
    if (failure === 'patch failure') {
      const { paths } = await createCursorFixture(join(dir, 'cursor'))
      await writeFile(paths.productJson, '{}')
      await writeFile(paths.alwaysLocalMain, 'exports.activate=123;')
    }
    await writeFile(join(dir, 'connection.json'), JSON.stringify(connect({
      gateway: { v1: 'http://127.0.0.1:1/v1', key: 'sandbox-only' }, models: [{ id: 'fixture/one' }],
    })))
    const port = await freePort(), running = launch(dir, port, true); children.push(running)
    await until(async () => JSON.parse(await readFile(join(dir, 'auto-setup.json'), 'utf8').catch(() => '{}')).state === 'failed', 'failure status missing')
    expect((await fetch(`http://127.0.0.1:${port}/health`).then(r => r.json()) as any).magpieCcursor).toBe(true)
    const status = await readFile(join(dir, 'auto-setup.json'), 'utf8')
    await sleep(2200)
    expect(await readFile(join(dir, 'auto-setup.json'), 'utf8')).toBe(status)
    expect(running.logs().match(/Automatic Cursor setup failed/g)).toHaveLength(1)
    expect(running.child.exitCode).toBeNull()
  }, 15000)
}
