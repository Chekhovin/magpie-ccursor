// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writePrivateJSON } from './connection'
import { cursorTargetFingerprint, resolveCursorPaths, setupCursor, type SetupOptions } from './setup'

export interface AutoSetupStatus {
  state: 'ready' | 'failed' | 'paused', updatedAt: string, fingerprint: string,
  appRoot?: string, version?: string, restartRequired: boolean, message: string,
}

// Called only by the daemon holding bridge.lock. A failed target is not retried until it changes,
// including across daemon restarts. Stable metadata avoids patching during an active update.
export function createAutoSetup(options: SetupOptions & {
  dataDir: string, now?: () => number, settleMs?: number, checkIntervalMs?: number,
}) {
  const { dataDir, log = console.error, now = Date.now, settleMs = 2000, checkIntervalMs = 30000 } = options
  const statusPath = join(dataDir, 'auto-setup.json')
  let loaded = false, previous: AutoSetupStatus | undefined
  let candidate = '', changedAt = 0, nextCheck = 0, completed = ''
  async function fingerprint() {
    let target: string
    try { target = cursorTargetFingerprint(options) }
    catch (error) { target = JSON.stringify([options.appRoot ?? process.env.CCURSOR_CURSOR_ROOT ?? 'auto-detect', String(error)]) }
    // Manual restore/setup changes intent even if the Cursor installation itself is unchanged.
    const snapshot = await stat(join(dataDir, 'patch-manifest.json')).catch(() => undefined)
    const lock = await stat(join(dataDir, 'patch.lock')).catch(() => undefined)
    return JSON.stringify(['renderer-model-catalog-v1', target, snapshot?.mtimeMs, snapshot?.ctimeMs, snapshot?.size, lock?.mtimeMs, lock?.size])
  }
  return async function reconcileAutoSetup() {
    if (now() < nextCheck) return
    if (!loaded) {
      loaded = true
      try { previous = JSON.parse(await readFile(statusPath, 'utf8')) }
      catch { /* A status file is informational; the patch manifest remains authoritative. */ }
    }
    const target = await fingerprint()
    if (target === completed || (previous?.state === 'failed' && previous.fingerprint === target)) {
      nextCheck = now() + checkIntervalMs
      return
    }
    if (candidate !== target) { candidate = target; changedAt = now() }
    if (now() - changedAt < settleMs) return
    let status: AutoSetupStatus
    let paths: ReturnType<typeof resolveCursorPaths> | undefined
    try {
      const snapshot = JSON.parse(await readFile(join(dataDir, 'patch-manifest.json'), 'utf8').catch(() => 'null'))
      if (snapshot?.state === 'restored') {
        const message = 'Automatic Cursor setup is paused after manual restore. To enable it again, close Cursor and run: magpie-ccursor setup --cursor-closed'
        if (previous?.state !== 'paused') log(message)
        status = { state: 'paused', updatedAt: new Date().toISOString(), fingerprint: target,
          appRoot: snapshot.appRoot, version: snapshot.version, restartRequired: false, message }
      } else {
        paths = resolveCursorPaths(options)
        const result = await setupCursor({ ...options, paths, log })
        status = { state: 'ready', updatedAt: new Date().toISOString(), fingerprint: await fingerprint(),
          appRoot: paths.appRoot, version: paths.cursorVersion,
          restartRequired: result.changed || (previous?.restartRequired === true && previous.fingerprint === target),
          message: result.changed ? 'Cursor hooks installed. Restart any open Cursor window once, then enable the CCursor Agent in Magpie.' : 'Cursor hooks are ready.' }
      }
    } catch (error) {
      const message = `Automatic Cursor setup failed: ${error instanceof Error ? error.message : String(error)} Waiting for the Cursor installation to change; manual setup can retry after the cause is fixed.`
      log(message)
      status = { state: 'failed', updatedAt: new Date().toISOString(), fingerprint: await fingerprint(),
        appRoot: paths?.appRoot, version: paths?.cursorVersion, restartRequired: false, message }
    }
    completed = status.fingerprint
    previous = status
    nextCheck = now() + checkIntervalMs
    try { await writePrivateJSON(statusPath, status) }
    catch (error) { log(`Cannot write automatic Cursor setup status (${statusPath}): ${error}`) }
  }
}
