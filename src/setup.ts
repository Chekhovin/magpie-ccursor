// SPDX-License-Identifier: AGPL-3.0-or-later
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { dataDirectory, writePrivateJSON } from './connection'
import { findCursorPathsDetailed, formatDiagnostic } from '../vendor/installer/detect.js'
import { isInjectPatched, patchInject } from '../vendor/installer/patch-inject.js'
import { inspectAlwaysLocalPatch, patchAlwaysLocal } from '../vendor/installer/patch-always-local.js'
import { getAgentHostBackupTargets, isAgentHostPatched, patchAgentHost } from '../vendor/installer/patch-agent-host.js'
import { isProxy39Patched, needsProxy39Patch, patchProxy39 } from '../vendor/installer/patch-proxy-39.js'
import { patchKatex } from '../vendor/installer/patch-katex.js'

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
export async function snapshotTransaction(files: string[], directory: string, action: () => Promise<void> | void) {
  const backupDir = join(directory, `backup-${randomUUID()}`)
  await mkdir(backupDir, { recursive: true })
  const entries = []
  for (const [index, file] of [...new Set(files)].filter(existsSync).entries()) {
    const backup = join(backupDir, `${index}.original`)
    await copyFile(file, backup)
    entries.push({ file, backup, originalHash: digest(await readFile(file)), patchedHash: '' })
  }
  const manifestPath = join(directory, 'patch-manifest.json')
  await writePrivateJSON(manifestPath, { state: 'applying', entries })
  try {
    await action()
    for (const entry of entries) entry.patchedHash = digest(await readFile(entry.file))
    await writePrivateJSON(manifestPath, { state: 'applied', entries })
  } catch (error) {
    for (const entry of entries) await copyFile(entry.backup, entry.file)
    await writePrivateJSON(manifestPath, { state: 'rolled-back', entries })
    throw error
  }
}

export async function restoreSnapshot(directory = dataDirectory()) {
  const path = join(directory, 'patch-manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest.state === 'restored' || manifest.state === 'rolled-back') return
  if (manifest.state !== 'applied') throw new Error('Setup was interrupted. Review patch-manifest.json and its backups before restoring manually.')
  for (const entry of manifest.entries) {
    const current = digest(await readFile(entry.file))
    if (current !== entry.patchedHash && current !== entry.originalHash)
      throw new Error(`Cursor changed after setup; refusing to overwrite ${entry.file}. Use the saved backup only after reviewing the change.`)
    if (digest(await readFile(entry.backup)) !== entry.originalHash)
      throw new Error(`Backup verification failed: ${entry.backup}`)
  }
  for (const entry of manifest.entries) {
    if (digest(await readFile(entry.file)) !== entry.originalHash) await copyFile(entry.backup, entry.file)
  }
  await writePrivateJSON(path, { ...manifest, state: 'restored' })
}

export function cursorStatus() {
  const { paths, diagnostic } = findCursorPathsDetailed()
  if (!paths) return { installed: false, diagnostic: formatDiagnostic(diagnostic) }
  const renderer = isInjectPatched(readFileSync(paths.workbenchJs, 'utf8'))
  const glass = !existsSync(paths.glassJs) || isInjectPatched(readFileSync(paths.glassJs, 'utf8'))
  const agent = isAgentHostPatched(paths)
  const alwaysLocal = inspectAlwaysLocalPatch(paths).fullyPatched
  const proxy = !needsProxy39Patch(paths) || isProxy39Patched(paths)
  return { installed: true, root: paths.appRoot, version: paths.cursorVersion, renderer, glass, agent, alwaysLocal, proxy,
    ready: renderer && glass && agent && alwaysLocal && proxy }
}

export async function setupCursor() {
  const { paths, diagnostic } = findCursorPathsDetailed()
  if (!paths) throw new Error(formatDiagnostic(diagnostic))
  const status = cursorStatus()
  if (status.ready) {
    console.log('Cursor already has CCursor hooks. Keep its original server stopped; this bridge listens on 127.0.0.1:39831. No Cursor files changed.')
    return
  }
  // Mixing an unknown partial patch with a new one can break both installations.
  if (readFileSync(paths.workbenchJs, 'utf8').includes('__byokWrapTransport'))
    throw new Error('Existing CCursor hooks are incomplete. Repair them with their original installer or use a clean Cursor installation; this setup will not overwrite them.')
  const manifestPath = join(dataDirectory(), 'patch-manifest.json')
  if (existsSync(manifestPath)) {
    const { state } = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (state === 'applied' || state === 'applying') throw new Error('An existing patch snapshot must be reviewed/restored before setup can run again.')
  }
  const files = [paths.productJson, paths.workbenchJs, paths.glassJs, paths.alwaysLocalMain,
    paths.extensionHostJs, paths.alwaysLocalSingletonJs, ...getAgentHostBackupTargets(paths),
    join(paths.appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html')]
  await snapshotTransaction(files, dataDirectory(), () => {
    patchInject(paths, console.log)
    patchAlwaysLocal(paths, console.log)
    patchAgentHost(paths, console.log)
    patchProxy39(paths, console.log)
    patchKatex(paths, console.log)
    if (!cursorStatus().ready) throw new Error('Cursor hook verification failed.')
  })
  console.log('Cursor hooks installed. Start Magpie, connect the CCursor Agent, then restart Cursor.')
}
