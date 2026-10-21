// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function superviseBridge({ dataDir, port, log = console.error, restartDelay = 1000, spawnProcess = spawn }: {
  dataDir: string, port?: number, log?: (message: string) => void,
  restartDelay?: number, spawnProcess?: typeof spawn,
}) {
  let child: ChildProcess | undefined
  let stopped = false
  let attempts = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  const args = [fileURLToPath(new URL('./daemon.ts', import.meta.url)), '--managed', dataDir, ...(port ? [String(port)] : [])]
  function schedule() {
    if (stopped || retry) return
    const delay = Math.min(restartDelay * 2 ** Math.min(attempts++, 5), 30000)
    retry = setTimeout(() => { retry = undefined; start() }, delay)
  }
  function start() {
    if (stopped) return
    const started = Date.now()
    try {
      const instance = spawnProcess(process.execPath, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
      child = instance
      instance.stderr?.on('data', data => log(`[CCursor] ${String(data).trimEnd()}`))
      instance.on('error', error => log(`[CCursor] Bridge process error: ${error.message}`))
      // close follows both spawn errors and process exits; retry exactly once.
      instance.once('close', code => {
        if (child === instance) child = undefined
        if (stopped) return
        if (Date.now() - started > 30000) attempts = 0
        log(`[CCursor] Bridge exited (${code ?? 'signal'}); restarting.`)
        schedule()
      })
    } catch (error) {
      child = undefined
      log(`[CCursor] Cannot start bridge: ${error instanceof Error ? error.message : 'unknown error'}`)
      schedule()
    }
  }
  function stop() {
    stopped = true
    if (retry) clearTimeout(retry)
    child?.stdin?.end()
    process.removeListener('exit', stop)
  }
  process.once('exit', stop)
  start()
  return { stop }
}
