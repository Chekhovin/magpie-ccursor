// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readFile, open, unlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDirectory, PORT, readConnection, toProviders, writePrivateJSON } from './connection'
import { startRuntime } from './runtime'
import { createAutoSetup } from './auto-setup'

const managed = process.argv[2] === '--managed'
const dataDir = managed ? process.argv[3] : dataDirectory()
const port = managed && process.argv[4] ? Number(process.argv[4]) : PORT
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port.')
if (!dataDir) throw new Error('Missing CCursor data directory.')
await mkdir(dataDir, { recursive: true, mode: 0o700 })
const lockPath = join(dataDir, 'bridge.lock')
let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined
let ownsLock = false
let stopped = false
let previous = ''
let lastError = ''
let queue = Promise.resolve()
const autoSetup = createAutoSetup({ dataDir })

async function lock() {
  if (ownsLock) return true
  try {
    const handle = await open(lockPath, 'wx', 0o600)
    try { await handle.writeFile(String(process.pid)) }
    catch (error) { await handle.close(); await unlink(lockPath).catch(() => {}); throw error }
    await handle.close()
    ownsLock = true
    return true
  } catch (error: any) {
    if (error.code !== 'EEXIST') throw error
    const content = await readFile(lockPath, 'utf8').catch(() => '')
    const pid = Number(content)
    if (!Number.isInteger(pid) || pid < 1) {
      const info = await stat(lockPath).catch(() => null)
      // Do not remove a lock another process is still writing.
      if (info && Date.now() - info.mtimeMs > 3000 && await readFile(lockPath, 'utf8').catch(() => null) === content)
        await unlink(lockPath).catch(() => {})
      return false
    }
    try { process.kill(pid, 0) }
    catch (error: any) {
      if (error.code === 'ESRCH') await unlink(lockPath).catch(() => {})
    }
    return false
  }
}

async function reconcile() {
  if (stopped || !(await lock())) return
  // Setup errors must never tear down a healthy bridge or depend on Agent credentials.
  if (process.env.MAGPIE_CCURSOR_SKIP_AUTO_SETUP !== '1') {
    try { await autoSetup() }
    catch (error) { console.error(`Automatic Cursor setup error: ${error}`) }
  }
  try {
    const providers = toProviders(await readConnection(dataDir))
    if (!providers) {
      if (runtime) { await runtime.stop(); runtime = undefined }
      previous = ''
      await writePrivateJSON(join(dataDir, 'providers.json'), { $schemaVersion: 1, providers: [] })
      return
    }
    const next = JSON.stringify(providers)
    if (next !== previous) {
      await writePrivateJSON(join(dataDir, 'providers.json'), providers)
      previous = next
    }
    if (!runtime) {
      // Default route list comes from the fresh upstream source. No ~/.ccursor reads.
      const { DEFAULT_ROUTES } = await import('../vendor/server/data/defaults')
      await writePrivateJSON(join(dataDir, 'routes.json'), { ...DEFAULT_ROUTES, byokMode: 1, server: { host: '127.0.0.1', port } })
      runtime = await startRuntime({ dataDir, port })
      console.error(`Bridge ready on 127.0.0.1:${runtime.port}. Select a model in Cursor.`)
    }
    lastError = ''
  } catch (error: any) {
    // Fail closed after a malformed/removed connection; keep no stale gateway credentials active.
    if (runtime) { await runtime.stop(); runtime = undefined }
    previous = ''
    const message = error?.code === 'EADDRINUSE'
      ? `Port ${port} is in use. Stop the original CCursor server, then retry.`
      : error instanceof Error ? error.message : 'Bridge reconciliation failed.'
    if (message !== lastError) { console.error(message); lastError = message }
  }
}

const tick = () => { queue = queue.then(reconcile).catch((error) => console.error(error.message)) }
const timer = setInterval(tick, 1000)
async function shutdown() {
  if (stopped) return
  stopped = true
  clearInterval(timer)
  const deadline = setTimeout(() => process.exit(1), 4000)
  try {
    await queue
    await runtime?.stop()
    if (ownsLock) await unlink(lockPath).catch(() => {})
  } finally { clearTimeout(deadline); process.exit(0) }
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
if (managed) { process.stdin.resume(); process.stdin.once('end', shutdown); process.stdin.once('error', shutdown) }
tick()
