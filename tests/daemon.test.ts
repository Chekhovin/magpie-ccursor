import { afterEach, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile, mkdir, utimes } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from '../agent.mjs'

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
function launch(dir: string, port: number) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/daemon.ts', import.meta.url)), '--managed', dir, String(port)], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
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
