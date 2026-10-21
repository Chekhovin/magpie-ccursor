// SPDX-License-Identifier: AGPL-3.0-or-later
import { copyFile, mkdir, readFile, open, unlink } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { dataDirectory, writePrivateJSON } from './connection'
import { findCursorPathsDetailed, formatDiagnostic } from '../vendor/installer/detect.js'
import { isInjectPatched, isLocalLoopCompatible, isModelCatalogCompatible, patchInject } from '../vendor/installer/patch-inject.js'
import { inspectAlwaysLocalPatch, patchAlwaysLocal } from '../vendor/installer/patch-always-local.js'
import { findAgentHostNetworkTargets, getAgentHostBackupTargets, isAgentHostPatched, patchAgentHost } from '../vendor/installer/patch-agent-host.js'
import { isProxy39Patched, needsProxy39Patch, patchProxy39 } from '../vendor/installer/patch-proxy-39.js'
import { patchKatex } from '../vendor/installer/patch-katex.js'

export interface CursorPaths {
  appRoot: string, cursorVersion: string, hasGlass: boolean,
  workbenchJs: string, glassJs: string, alwaysLocalMain: string, extensionHostJs: string,
  alwaysLocalSingletonJs: string, agentHostDist: string, agentHostMain: string,
  agentHostPackageJson: string, productJson: string,
}
export interface SetupOptions { dataDir?: string, appRoot?: string, paths?: CursorPaths, log?: (message: string) => void }
interface SnapshotEntry { file: string, backup: string, originalHash: string, patchedHash: string }
interface Snapshot {
  state: 'applying' | 'applied' | 'rolled-back' | 'restored', entries: SnapshotEntry[],
  appRoot?: string, version?: string, packageHash?: string,
}
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')

async function withPatchLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'patch.lock')
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() })
  let handle
  try { handle = await open(path, 'wx', 0o600) }
  catch (error: any) {
    if (error.code !== 'EEXIST') throw error
    // Never unlink a lock based on a PID probe: a concurrent owner could replace it.
    throw new Error(`Another Cursor setup or restore is in progress, or a previous operation left ${path}. Retry after it finishes; if no setup or restore is running, review the snapshot before removing that lock.`)
  }
  try { await handle.writeFile(owner) }
  catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error }
  await handle.close()
  try { return await action() }
  finally { if (await readFile(path, 'utf8').catch(() => '') === owner) await unlink(path).catch(() => {}) }
}

// The upstream detector has no explicit-root argument; avoid changing process.env during setup.
export function resolveCursorPaths(options: SetupOptions = {}): CursorPaths {
  if (options.paths) return options.paths
  if (!options.appRoot) {
    const { paths, diagnostic } = findCursorPathsDetailed()
    if (!paths) throw new Error(formatDiagnostic(diagnostic))
    return paths
  }
  const appRoot = resolve(options.appRoot)
  const cursorVersion = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')).version
  if (typeof cursorVersion !== 'string') throw new Error('Cursor package version is missing.')
  const [major, minor] = cursorVersion.split('.').map(Number)
  return {
    appRoot, cursorVersion, hasGlass: major > 3 || (major === 3 && minor >= 8),
    workbenchJs: join(appRoot, 'out/vs/workbench/workbench.desktop.main.js'),
    glassJs: join(appRoot, 'out/vs/workbench/workbench.glass.main.js'),
    alwaysLocalMain: join(appRoot, 'extensions/cursor-always-local/dist/main.js'),
    extensionHostJs: join(appRoot, 'out/vs/workbench/api/node/extensionHostProcess.js'),
    alwaysLocalSingletonJs: join(appRoot, 'out/vs/code/electron-utility/alwaysLocalSingleton/alwaysLocalSingletonMain.js'),
    agentHostDist: join(appRoot, 'extensions/cursor-agent-host/dist'),
    agentHostMain: join(appRoot, 'extensions/cursor-agent-host/dist/main.js'),
    agentHostPackageJson: join(appRoot, 'extensions/cursor-agent-host/package.json'),
    productJson: join(appRoot, 'product.json'),
  }
}

export function cursorPatchFiles(paths: CursorPaths) {
  // Include every live chunk for partial-patch detection, including chunks whose fingerprints changed.
  const chunks = existsSync(paths.agentHostDist) ? readdirSync(paths.agentHostDist)
    .filter(name => name.endsWith('.js')).map(name => join(paths.agentHostDist, name)) : []
  return [...new Set([paths.productJson, paths.workbenchJs, paths.glassJs, paths.alwaysLocalMain,
    paths.extensionHostJs, paths.alwaysLocalSingletonJs, ...getAgentHostBackupTargets(paths),
    ...findAgentHostNetworkTargets(paths), ...chunks,
    join(paths.appRoot, 'out/vs/code/electron-sandbox/workbench/workbench.html')])]
}

// Cheap change detection only. Safety decisions below use full source inspection and hashes.
export function cursorTargetFingerprint(options: SetupOptions = {}) {
  const paths = resolveCursorPaths(options)
  const files = [...cursorPatchFiles(paths), join(paths.appRoot, 'package.json'), paths.agentHostPackageJson]
  return JSON.stringify([paths.appRoot, paths.cursorVersion, ...files.map(file => {
    try { const s = statSync(file); return [file, s.size, s.mtimeMs, s.ctimeMs, s.mode] }
    catch (error: any) { if (error.code === 'ENOENT') return [file, 'missing']; throw error }
  })])
}

async function readSnapshot(directory: string): Promise<Snapshot | undefined> {
  let manifest: Snapshot
  try { manifest = JSON.parse(await readFile(join(directory, 'patch-manifest.json'), 'utf8')) }
  catch (error: any) {
    if (error.code === 'ENOENT') return
    throw new Error(`Patch snapshot is damaged; review patch-manifest.json and its backups: ${error.message}`)
  }
  if (!manifest || !['applying', 'applied', 'rolled-back', 'restored'].includes(manifest.state)
    || !Array.isArray(manifest.entries) || !manifest.entries.length
    || manifest.entries.some(e => typeof e.file !== 'string' || typeof e.backup !== 'string'
      || !/^[a-f0-9]{64}$/.test(e.originalHash) || (manifest.state === 'applied' && !/^[a-f0-9]{64}$/.test(e.patchedHash))))
    throw new Error('Patch snapshot is damaged; review patch-manifest.json and its backups.')
  if (manifest.state === 'applying')
    throw new Error('Setup was interrupted. Review patch-manifest.json and its backups before continuing.')
  for (const entry of manifest.entries) {
    if (digest(await readFile(entry.backup)) !== entry.originalHash)
      throw new Error(`Backup verification failed: ${entry.backup}`)
  }
  return manifest
}

export async function snapshotTransaction(files: string[], directory: string, action: () => Promise<void> | void,
  metadata: Pick<Snapshot, 'appRoot' | 'version' | 'packageHash'> = {}, upgrade = false) {
  const previous = await readSnapshot(directory)
  const backupDir = join(directory, `backup-${randomUUID()}`)
  await mkdir(backupDir, { recursive: true })
  const entries: SnapshotEntry[] = []
  for (const [index, file] of [...new Set(files)].entries()) {
    const backup = join(backupDir, `${index}.original`)
    // Missing targets are filtered by the caller, never silently dropped during backup.
    await copyFile(file, backup)
    const originalHash = digest(await readFile(backup))
    if (digest(await readFile(file)) !== originalHash) throw new Error(`Cursor changed during backup: ${file}`)
    entries.push({ file, backup, originalHash, patchedHash: '' })
  }
  if (!entries.length) throw new Error('No Cursor files to back up.')
  if (upgrade && (!previous || previous.state !== 'applied'
    || previous.appRoot !== metadata.appRoot || previous.packageHash !== metadata.packageHash
    || previous.entries.length !== entries.length
    || entries.some(entry => previous.entries.find(old => old.file === entry.file)?.patchedHash !== entry.originalHash)))
    throw new Error('Recorded Cursor hooks changed before upgrade; no application files were modified.')
  if (previous) await writePrivateJSON(join(directory, `patch-history-${randomUUID()}.json`), previous)
  const manifest: Snapshot = { ...metadata, state: 'applying', entries }
  const save = async () => {
    await writePrivateJSON(join(backupDir, 'manifest.json'), manifest)
    await writePrivateJSON(join(directory, 'patch-manifest.json'), manifest)
  }
  // No target writes until every original and the recovery manifest are safely recorded.
  await save()
  for (const entry of entries) {
    if (digest(await readFile(entry.file)) !== entry.originalHash)
      throw new Error(`Cursor changed during backup; snapshot needs review: ${entry.file}`)
  }
  try {
    await action()
    for (const entry of entries) entry.patchedHash = digest(await readFile(entry.file))
    manifest.state = 'applied'
    if (upgrade) {
      // Preserve the original clean installation, not the previous plugin's patched bytes.
      manifest.entries = entries.map(entry => {
        const original = previous!.entries.find(old => old.file === entry.file)!
        return { ...entry, backup: original.backup, originalHash: original.originalHash }
      })
    }
    await save()
  } catch (error) {
    manifest.entries = entries
    // An external updater owns the new version. Never copy this version's originals over it.
    if (metadata.appRoot && metadata.packageHash) {
      const currentPackage = await readFile(join(metadata.appRoot, 'package.json')).catch(() => null)
      if (!currentPackage || digest(currentPackage) !== metadata.packageHash) {
        manifest.state = 'applying'
        await save()
        throw new Error(`Cursor changed version during setup; rollback was skipped to preserve the updated files. Review patch-manifest.json and its backups. Cause: ${error}`)
      }
    }
    // Attempt every rollback even when a locked file prevents restoring one of them.
    const failures: string[] = []
    for (const entry of entries) {
      try { await copyFile(entry.backup, entry.file) }
      catch { failures.push(entry.file) }
    }
    manifest.state = failures.length ? 'applying' : 'rolled-back'
    await save()
    if (failures.length) throw new Error(`Setup failed and rollback is incomplete; review backups for: ${failures.join(', ')}. Cause: ${error}`)
    if (upgrade) await writePrivateJSON(join(directory, 'patch-manifest.json'), previous)
    throw error
  }
}

export async function restoreSnapshot(directory = dataDirectory()) {
  return withPatchLock(directory, () => restoreSnapshotLocked(directory))
}

async function restoreSnapshotLocked(directory: string) {
  const manifest = await readSnapshot(directory)
  if (!manifest) throw new Error('No Cursor patch snapshot found.')
  if (manifest.state === 'restored' || manifest.state === 'rolled-back') return
  if (manifest.appRoot && manifest.packageHash
    && digest(await readFile(join(manifest.appRoot, 'package.json'))) !== manifest.packageHash)
    throw new Error('Cursor changed version after setup; refusing to restore an older version. Run setup for the current clean installation first.')
  for (const entry of manifest.entries) {
    const current = digest(await readFile(entry.file))
    if (current !== entry.patchedHash && current !== entry.originalHash)
      throw new Error(`Cursor changed after setup; refusing to overwrite ${entry.file}. Use the saved backup only after reviewing the change.`)
  }
  for (const entry of manifest.entries) {
    if (digest(await readFile(entry.file)) !== entry.originalHash) await copyFile(entry.backup, entry.file)
  }
  await writePrivateJSON(join(directory, 'patch-manifest.json'), { ...manifest, state: 'restored' })
}

export function cursorStatus(options: SetupOptions = {}) {
  let paths: CursorPaths
  try { paths = resolveCursorPaths(options) }
  catch (error) { return { installed: false, diagnostic: String(error) } }
  const rendererSource = readFileSync(paths.workbenchJs, 'utf8')
  const glassSource = existsSync(paths.glassJs) ? readFileSync(paths.glassJs, 'utf8') : undefined
  const renderer = isInjectPatched(rendererSource)
  const glass = glassSource ? isInjectPatched(glassSource) : !paths.hasGlass
  const localLoop = (renderer && glass)
    || (isLocalLoopCompatible(rendererSource) && (glassSource ? isLocalLoopCompatible(glassSource) : !paths.hasGlass))
  const modelCatalog = (renderer && glass)
    || (isModelCatalogCompatible(rendererSource) && (glassSource ? isModelCatalogCompatible(glassSource) : !paths.hasGlass))
  const agentRequired = Number(paths.cursorVersion.split('.')[0]) > 3
    || (Number(paths.cursorVersion.split('.')[0]) === 3 && Number(paths.cursorVersion.split('.')[1]) >= 13)
  const agent = (!agentRequired || existsSync(paths.agentHostMain)) && isAgentHostPatched(paths)
  const alwaysLocal = inspectAlwaysLocalPatch(paths).fullyPatched
  const extensionHost = readFileSync(paths.extensionHostJs, 'utf8')
  const signature = extensionHost.includes('if(!1)') && !/if\(!\w\.valid\)/.test(extensionHost)
  // Newer Cursor layouts can omit the legacy singleton entirely.
  const proxy = !needsProxy39Patch(paths) || isProxy39Patched(paths)
  return { installed: true, root: paths.appRoot, version: paths.cursorVersion, renderer, glass, agent, alwaysLocal, signature, proxy, localLoop, modelCatalog,
    ready: renderer && glass && agent && alwaysLocal && signature && proxy && localLoop && modelCatalog }
}

export async function setupCursor(options: SetupOptions = {}) {
  const directory = options.dataDir ?? dataDirectory()
  // No-op inspection does not own a write lock: transient hosts may exit during a large scan.
  // Keep damaged/interrupted snapshot validation before reporting a ready installation.
  await readSnapshot(directory)
  const status = cursorStatus(options)
  if (status.ready) return { ...status, changed: false }
  return withPatchLock(directory, () => setupCursorLocked({ ...options, dataDir: directory }))
}

async function setupCursorLocked(options: SetupOptions) {
  const directory = options.dataDir ?? dataDirectory(), log = options.log ?? console.log
  const paths = resolveCursorPaths(options)
  const manifest = await readSnapshot(directory)
  const status = cursorStatus({ paths })
  if (status.ready) return { ...status, changed: false }
  const files = cursorPatchFiles(paths).filter(existsSync)
  const packageHash = digest(await readFile(join(paths.appRoot, 'package.json')))
  // Upgrade only the renderer compatibility hooks of an intact installation recorded by us.
  if (manifest?.state === 'applied' && manifest.appRoot === paths.appRoot
    && manifest.packageHash === packageHash && status.agent && status.alwaysLocal && status.signature && status.proxy
    && files.length === manifest.entries.length
    && files.every(file => manifest.entries.some(entry => entry.file === file))
    && manifest.entries.every(entry => digest(readFileSync(entry.file)) === entry.patchedHash)) {
    await snapshotTransaction(files, directory, () => {
      patchInject(paths, log)
      if (!cursorStatus({ paths }).ready) throw new Error('Upgraded Cursor renderer hooks did not pass verification.')
      if (digest(readFileSync(join(paths.appRoot, 'package.json'))) !== packageHash) throw new Error('Cursor changed version during setup.')
    }, { appRoot: paths.appRoot, version: paths.cursorVersion, packageHash }, true)
    log('Cursor compatibility hooks updated. Restart any open Cursor window once to load the model and chat compatibility fixes.')
    return { ...cursorStatus({ paths }), changed: true }
  }
  for (const file of files) {
    if (!/\.(?:js|html)$/.test(file)) continue
    const source = readFileSync(file, 'utf8')
    if (/__byok|CURSOR-BYOK-HOOK|BYOK-PROXY39|BYOK-SINGLETON-ROUTER|BYOK-AGENT/.test(source)
      || (file.endsWith('workbench.html') && source.includes('../../../../../extensions/markdown-math/notebook-out/katex.min.css')))
      throw new Error(`Existing CCursor hooks are incomplete or Cursor is mid-upgrade: ${file}. Restore the matching snapshot or finish installing a clean Cursor; no files were changed.`)
  }
  if (!/if\(!\w\.valid\)/.test(readFileSync(paths.extensionHostJs, 'utf8')))
    throw new Error('Cursor extension host has an unknown or partial signature patch; refusing to overwrite it.')
  // A surviving patched file from the previous version is also evidence of a mixed installation.
  if (manifest?.state === 'applied') {
    for (const entry of manifest.entries) {
      if (files.includes(entry.file) && entry.originalHash !== entry.patchedHash && existsSync(entry.file)
        && digest(await readFile(entry.file)) === entry.patchedHash)
        throw new Error(`Cursor contains files from the previous patch snapshot: ${entry.file}. Finish the Cursor update before retrying.`)
    }
  }
  const product = JSON.parse(readFileSync(paths.productJson, 'utf8'))
  for (const [relative, expected] of Object.entries(product.checksums ?? {})) {
    const file = join(paths.appRoot, 'out', relative)
    if (!files.includes(file)) continue
    const actual = createHash('sha256').update(await readFile(file)).digest('base64').replace(/=+$/, '')
    if (actual !== expected) throw new Error(`Cursor checksum mismatch (possibly an update in progress): ${file}. No files were changed.`)
  }
  await snapshotTransaction(files, directory, () => {
    patchInject(paths, log)
    patchAlwaysLocal(paths, log)
    patchAgentHost(paths, log)
    patchProxy39(paths, log)
    patchKatex(paths, log)
    const verified = cursorStatus({ paths })
    if (!verified.ready) throw new Error(`Cursor hook verification failed (missing or incompatible installation files): ${JSON.stringify(verified)}`)
    if (digest(readFileSync(join(paths.appRoot, 'package.json'))) !== packageHash) throw new Error('Cursor changed version during setup.')
  }, { appRoot: paths.appRoot, version: paths.cursorVersion, packageHash })
  log('Cursor hooks installed. If Cursor is open, restart it once to load the hooks; enable the CCursor Agent in Magpie to use its models.')
  return { ...cursorStatus({ paths }), changed: true }
}
