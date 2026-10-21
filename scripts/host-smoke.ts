import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { connect } from '../agent.mjs'
import { createServer } from 'node:net'
import { createCursorFixture, sandboxEnvironment } from '../tests/fixtures/cursor'

// Run against an independently downloaded official internal/plugin/host.js.
// No user auth, installed CCursor data, or real model endpoint is used.
const host = process.argv[2]
if (!host) throw new Error('Usage: bun scripts/host-smoke.ts /path/to/official/host.js [sandbox-port; default random]')
const requestedPort = Number(process.argv[3] ?? 0)
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535 || requestedPort === 39831)
  throw new Error('Choose a sandbox port other than the user bridge port 39831.')
const reservation = createServer()
await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(requestedPort, '127.0.0.1', resolve) })
const port = (reservation.address() as { port: number }).port
await new Promise<void>(resolve => reservation.close(() => resolve()))
const url = `http://127.0.0.1:${port}`
const sandbox = await mkdtemp(join(tmpdir(), 'magpie-ccursor-host-'))
const dataDir = join(sandbox, '.magpie-ccursor')
await mkdir(dataDir)
await createCursorFixture(join(sandbox, 'cursor'))
const connection = connect({
  gateway: { v1: 'http://127.0.0.1:1/v1', key: 'host-fixture-only' },
  models: [{ id: 'fixture/host', name: 'Host fixture' }],
})
const child = spawn(process.execPath, [resolve(host)], { env: { ...sandboxEnvironment(sandbox), MAGPIE_CCURSOR_PORT: String(port) }, stdio: ['pipe', 'pipe', 'pipe'] })
let stdout = '', stderr = ''
child.stdout.on('data', data => { stdout += String(data) })
child.stderr.on('data', data => { stderr += String(data) })
const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
const deadline = setTimeout(() => { child.kill(); console.error('Official host smoke timed out.'); process.exitCode = 1 }, 20000)
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 120; i++) { if (await check()) return; await Bun.sleep(100) }
  throw new Error(`Official host condition timed out. ${stderr}`)
}
try {
  child.stdin.write(`${JSON.stringify({ id: 1, method: 'init', params: { authPath: join(sandbox, 'auth.json'), directory: sandbox, plugins: [{ spec: 'magpie-ccursor-fixture', target: resolve(import.meta.dir, '..') }] } })}\n`)
  await until(async () => stdout.split('\n').some(line => { try { const m = JSON.parse(line); return m.id === 1 } catch { return false } }))
  const result = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }).find(m => m.id === 1)
  if (result.error || result.result.plugins.some((p: any) => p.error)) throw new Error(JSON.stringify(result))
  await until(async () => JSON.parse(await readFile(join(dataDir, 'auto-setup.json'), 'utf8').catch(() => '{}')).state === 'ready')
  const snapshot = await readFile(join(dataDir, 'patch-manifest.json'), 'utf8')
  const initialStatus = await readFile(join(dataDir, 'auto-setup.json'), 'utf8')
  await writeFile(join(dataDir, 'connection.json'), JSON.stringify(connection))
  await until(async () => { try { return (await fetch(`${url}/health`).then(r => r.json()) as any).magpieCcursor === true } catch { return false } })
  const pid = Number(await readFile(join(dataDir, 'bridge.lock'), 'utf8'))
  process.kill(pid, 'SIGKILL')
  await until(async () => { const next = Number(await readFile(join(dataDir, 'bridge.lock'), 'utf8').catch(() => '')); return next > 0 && next !== pid })
  await until(async () => await readFile(join(dataDir, 'auto-setup.json'), 'utf8') !== initialStatus)
  await until(async () => { try { return (await fetch(`${url}/health`).then(r => r.json()) as any).magpieCcursor === true } catch { return false } })
  if (await readFile(join(dataDir, 'patch-manifest.json'), 'utf8') !== snapshot) throw new Error('Ready installation created another snapshot.')
  child.stdin.end()
  if (await exited !== 0) throw new Error(`Official host exited unsuccessfully: ${stderr}`)
  await until(async () => { try { await fetch(`${url}/health`, { signal: AbortSignal.timeout(250) }); return false } catch { return true } })
  console.log(`PASS: official Magpie host installed fixture Cursor hooks without Agent config; bridge on sandbox port ${port} recovered after termination and stopped after host exit.`)
} finally {
  clearTimeout(deadline)
  child.stdin.end()
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await exited.catch(() => {})
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
