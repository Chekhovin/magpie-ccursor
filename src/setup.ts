// SPDX-License-Identifier: AGPL-3.0-or-later
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { dataDirectory, writePrivateJSON } from './connection'
import { withPatchLock } from './patch-lock'
import { findCursorPathsDetailed, formatDiagnostic } from '../vendor/installer/detect.js'
import { isInjectCurrent, isLocalLoopCompatible, isModelCatalogCompatible, patchInject } from '../vendor/installer/patch-inject.js'
import { inspectAlwaysLocalPatch, patchAlwaysLocal } from '../vendor/installer/patch-always-local.js'
import { findAgentHostNetworkTargets, getAgentHostBackupTargets, inspectAgentHostPatch, patchAgentHost } from '../vendor/installer/patch-agent-host.js'
import { isProxy39Patched, needsProxy39Patch, patchProxy39 } from '../vendor/installer/patch-proxy-39.js'
import { patchKatex } from '../vendor/installer/patch-katex.js'
import { loadLocalizationCatalog, planLocalization, rendererPaths, type LocalizationCatalog, type LocalizationRecord } from './localization'
import { readLocalizationOption } from './plugin-options'
import { updateChecksums } from '../vendor/installer/checksum.js'

export interface CursorPaths {
  appRoot: string, cursorVersion: string, hasGlass: boolean,
  workbenchJs: string, glassJs: string, alwaysLocalMain: string, extensionHostJs: string,
  alwaysLocalSingletonJs: string, agentHostDist: string, agentHostMain: string,
  agentHostPackageJson: string, productJson: string,
}
export interface SetupOptions {
  dataDir?: string, appRoot?: string, paths?: CursorPaths, log?: (message: string) => void,
  /** Install the bundled reversible Cursor Chinese UI edits. Defaults to true. */
  localize?: boolean,
  /** A catalog can be injected by isolated compatibility tests. Never loaded from user options. */
  localizationCatalog?: LocalizationCatalog,
  /** Automatic setup must not override a user's explicit restore. */
  automatic?: boolean,
}
export class AutomaticSetupPausedError extends Error {
  constructor() { super('Automatic Cursor setup is paused after manual restore. Close Cursor and run setup explicitly to enable it again.'); this.name = 'AutomaticSetupPausedError' }
}
interface SnapshotEntry { file: string, backup: string, originalHash: string, patchedHash: string }
interface Snapshot {
  state: 'applying' | 'applied' | 'rolled-back' | 'restoring' | 'restored', entries: SnapshotEntry[],
  appRoot?: string, version?: string, packageHash?: string, localization?: LocalizationRecord,
}
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const pathIdentity = (file: string) => process.platform === 'win32' ? resolve(file).toLowerCase() : resolve(file)

function checkSetupIntent(manifest: Snapshot | undefined, automatic?: boolean) {
  if (automatic && (manifest?.state === 'restored' || manifest?.state === 'restoring'))
    throw new AutomaticSetupPausedError()
  if (manifest?.state === 'restoring')
    throw new Error('Restore was interrupted. Finish restore before explicitly enabling setup again.')
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

async function readSnapshot(directory: string, allowInterrupted = false): Promise<Snapshot | undefined> {
  let manifest: Snapshot
  try { manifest = JSON.parse(await readFile(join(directory, 'patch-manifest.json'), 'utf8')) }
  catch (error: any) {
    if (error.code === 'ENOENT') return
    throw new Error(`Patch snapshot is damaged; review patch-manifest.json and its backups: ${error.message}`)
  }
  if (!manifest || !['applying', 'applied', 'rolled-back', 'restoring', 'restored'].includes(manifest.state)
    || !Array.isArray(manifest.entries) || !manifest.entries.length
    || manifest.entries.some(e => !e || typeof e.file !== 'string' || typeof e.backup !== 'string'
      || !/^[a-f0-9]{64}$/.test(e.originalHash) || (['applied', 'restoring'].includes(manifest.state) && !/^[a-f0-9]{64}$/.test(e.patchedHash)))
    || new Set(manifest.entries.map(e => pathIdentity(e.file))).size !== manifest.entries.length)
    throw new Error('Patch snapshot is damaged; review patch-manifest.json and its backups.')
  if (!allowInterrupted && (manifest.state === 'applying' || manifest.state === 'restoring'))
    throw new Error('Setup or restore was interrupted. Review patch-manifest.json and its backups before continuing.')
  for (const entry of manifest.entries) {
    if (digest(await readFile(entry.backup)) !== entry.originalHash)
      throw new Error(`Backup verification failed: ${entry.backup}`)
  }
  return manifest
}

async function recoverCleanInterruptedSetup(directory: string, manifest: Snapshot, paths: CursorPaths,
  state: 'rolled-back' | 'restored', log: (message: string) => void) {
  if (!manifest.appRoot || manifest.version !== paths.cursorVersion || !manifest.packageHash
    || pathIdentity(await realpath(manifest.appRoot)) !== pathIdentity(await realpath(paths.appRoot))
    || digest(await readFile(join(paths.appRoot, 'package.json'))) !== manifest.packageHash)
    throw new Error('Setup was interrupted for another Cursor version or location; no old files will be restored. Review its snapshot and backups.')
  const files = cursorPatchFiles(paths).filter(existsSync)
  const expected = new Set(files.map(pathIdentity))
  if (manifest.entries.length !== files.length || manifest.entries.some(entry => !expected.has(pathIdentity(entry.file))))
    throw new Error('Interrupted setup target set changed; review the snapshot before retrying.')
  for (const entry of manifest.entries) {
    if (digest(await readFile(entry.file)) !== entry.originalHash)
      throw new Error(`Interrupted setup contains changed files: ${entry.file}. Automatic recovery will not overwrite them.`)
  }
  // A compatibility upgrade's "originals" can be old patched files. Only a clean baseline qualifies.
  await assertCleanInstallation(paths, undefined, true)
  if (digest(await readFile(join(paths.appRoot, 'package.json'))) !== manifest.packageHash)
    throw new Error('Cursor changed during interrupted-setup verification.')
  await writePrivateJSON(join(directory, `patch-history-${randomUUID()}.json`), manifest)
  const recovered: Snapshot = { ...manifest, state }
  await writePrivateJSON(join(directory, 'patch-manifest.json'), recovered)
  log('Interrupted Cursor setup verified: every target still matches its clean original. Recovery record retained.')
  return recovered
}

export async function snapshotTransaction(files: string[], directory: string, action: () => Promise<void> | void,
  metadata: Pick<Snapshot, 'appRoot' | 'version' | 'packageHash' | 'localization'> = {}, upgrade = false) {
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
  const manifest = await readSnapshot(directory, true)
  if (!manifest) throw new Error('No Cursor patch snapshot found.')
  if (manifest.state === 'restored') return
  if (manifest.state === 'applying') {
    if (!manifest.appRoot) throw new Error('Interrupted setup has no recorded Cursor location.')
    await recoverCleanInterruptedSetup(directory, manifest, resolveCursorPaths({ appRoot: manifest.appRoot }), 'restored', () => {})
    return
  }
  if (manifest.appRoot && manifest.packageHash
    && digest(await readFile(join(manifest.appRoot, 'package.json'))) !== manifest.packageHash)
    throw new Error('Cursor changed version after setup; refusing to restore an older version. Run setup for the current clean installation first.')
  for (const entry of manifest.entries) {
    const current = digest(await readFile(entry.file))
    if (current !== entry.patchedHash && current !== entry.originalHash)
      throw new Error(`Cursor changed after setup; refusing to overwrite ${entry.file}. Use the saved backup only after reviewing the change.`)
  }
  if (manifest.state !== 'rolled-back') {
    // Persist manual intent before touching a target. Automatic setup must stay paused after a crash.
    await writePrivateJSON(join(directory, 'patch-manifest.json'), { ...manifest, state: 'restoring' })
    for (const entry of manifest.entries) {
      const current = digest(await readFile(entry.file))
      if (current !== entry.patchedHash && current !== entry.originalHash)
        throw new Error(`Cursor changed during restore: ${entry.file}. No further files were restored.`)
      if (current !== entry.originalHash) await copyFile(entry.backup, entry.file)
    }
  }
  await writePrivateJSON(join(directory, 'patch-manifest.json'), { ...manifest, state: 'restored' })
}

export function cursorStatus(options: SetupOptions = {}) {
  let paths: CursorPaths
  try { paths = resolveCursorPaths(options) }
  catch (error) { return { installed: false, diagnostic: String(error) } }
  const rendererSource = readFileSync(paths.workbenchJs, 'utf8')
  const glassSource = existsSync(paths.glassJs) ? readFileSync(paths.glassJs, 'utf8') : undefined
  const renderer = isInjectCurrent(rendererSource)
  const glass = glassSource ? isInjectCurrent(glassSource) : !paths.hasGlass
  const localLoop = (renderer && glass)
    || (isLocalLoopCompatible(rendererSource) && (glassSource ? isLocalLoopCompatible(glassSource) : !paths.hasGlass))
  const modelCatalog = (renderer && glass)
    || (isModelCatalogCompatible(rendererSource) && (glassSource ? isModelCatalogCompatible(glassSource) : !paths.hasGlass))
  const agentRequired = Number(paths.cursorVersion.split('.')[0]) > 3
    || (Number(paths.cursorVersion.split('.')[0]) === 3 && Number(paths.cursorVersion.split('.')[1]) >= 13)
  const agentState = inspectAgentHostPatch(paths)
  const agent = (!agentRequired || existsSync(paths.agentHostMain)) && agentState.fullyPatched
  const agentTurnRoute = agentState.turnRoute
  const alwaysLocal = inspectAlwaysLocalPatch(paths).fullyPatched
  const extensionHost = readFileSync(paths.extensionHostJs, 'utf8')
  const signature = extensionHost.includes('if(!1)') && !/if\(!\w\.valid\)/.test(extensionHost)
  // Newer Cursor layouts can omit the legacy singleton entirely.
  const proxy = !needsProxy39Patch(paths) || isProxy39Patched(paths)
  return { installed: true, root: paths.appRoot, version: paths.cursorVersion, renderer, glass, agent, alwaysLocal, signature, proxy, localLoop, modelCatalog, agentTurnRoute,
    ready: renderer && glass && agent && alwaysLocal && signature && proxy && localLoop && modelCatalog }
}

function verifyAppliedSnapshot(paths: CursorPaths, manifest: Snapshot) {
  const targets = cursorPatchFiles(paths).filter(existsSync)
  if (manifest.state !== 'applied' || !manifest.appRoot || pathIdentity(manifest.appRoot) !== pathIdentity(paths.appRoot)
    || manifest.version !== paths.cursorVersion || manifest.packageHash !== digest(readFileSync(join(paths.appRoot, 'package.json')))
    || targets.length !== manifest.entries.length
    || manifest.entries.some(e => !targets.some(file => pathIdentity(file) === pathIdentity(e.file))))
    throw new Error('Cursor installation no longer matches the recorded localization snapshot; no files were changed.')
  for (const entry of manifest.entries) if (digest(readFileSync(entry.file)) !== entry.patchedHash)
    throw new Error(`Cursor file changed outside this plugin: ${entry.file}. Localization state cannot be confirmed.`)
}

export async function setupCursor(options: SetupOptions = {}) {
  const directory = options.dataDir ?? dataDirectory()
  const localize = options.localize ?? await readLocalizationOption(directory)
  const catalog = options.localizationCatalog ?? loadLocalizationCatalog()
  const manifest = await readSnapshot(directory, true)
  checkSetupIntent(manifest, options.automatic)
  const status = cursorStatus(options)
  // No-op inspection does not acquire a write lock. New preferences/revisions must reconcile.
  if (manifest?.state !== 'applying' && status.ready && manifest?.localization?.requested === localize
    && manifest.localization.revision === catalog.revision) {
    verifyAppliedSnapshot(resolveCursorPaths(options), manifest)
    return { ...status, changed: false, localization: manifest.localization }
  }
  return withPatchLock(directory, () => setupCursorLocked({ ...options, dataDir: directory, localize, localizationCatalog: catalog }))
}

async function prepareLocalization(paths: CursorPaths, enabled: boolean, catalog: LocalizationCatalog, manifest?: Snapshot) {
  const sources = new Map<string, Buffer>()
  for (const relative of rendererPaths) {
    const file = join(paths.appRoot, relative)
    if (!existsSync(file)) continue
    const entry = manifest?.entries.find(e => pathIdentity(e.file) === pathIdentity(file))
    if (manifest && !entry) throw new Error(`Localization target is outside the recorded snapshot: ${file}`)
    sources.set(relative, await readFile(entry?.backup ?? file))
  }
  return planLocalization(paths.cursorVersion, sources, enabled, catalog)
}

async function writeLocalizedRenderers(paths: CursorPaths, plan: ReturnType<typeof planLocalization>) {
  for (const [relative, source] of plan.outputs) await writeFile(join(paths.appRoot, relative), source)
}

function localizePickerSelector(paths: CursorPaths, enabled: boolean, log: (message: string) => void) {
  if (!enabled) return
  const end = '/* CURSOR-BYOK-HOOK-END */'
  const from = 'input[placeholder="Search models"]', to = 'input[placeholder="搜索模型"]'
  const changed: string[] = []
  for (const file of [paths.workbenchJs, paths.glassJs].filter(existsSync)) {
    const source = readFileSync(file, 'utf8'), at = source.indexOf(end)
    if (at < 0) throw new Error('Missing Cursor hook during localization.')
    const payload = source.slice(0, at)
    if (payload.split(from).length !== 2) throw new Error('Cursor model picker selector changed; localization was cancelled.')
    // Only this display selector changes; local-loop and catalog helpers remain byte-identical.
    const output = payload.replace(from, to) + source.slice(at)
    writeFileSync(file, output)
    changed.push(file)
  }
  updateChecksums(paths, changed, 'localization', log)
}

async function setupCursorLocked(options: SetupOptions) {
  const directory = options.dataDir ?? dataDirectory(), log = options.log ?? console.log
  const paths = resolveCursorPaths(options), localize = options.localize !== false
  const catalog = options.localizationCatalog ?? loadLocalizationCatalog()
  let manifest = await readSnapshot(directory, true)
  checkSetupIntent(manifest, options.automatic)
  if (manifest?.state === 'applying')
    manifest = await recoverCleanInterruptedSetup(directory, manifest, paths, 'rolled-back', log)
  const status = cursorStatus({ paths })
  if (status.ready && manifest?.localization?.requested === localize && manifest.localization.revision === catalog.revision) {
    verifyAppliedSnapshot(paths, manifest)
    return { ...status, changed: false, localization: manifest.localization }
  }
  const files = cursorPatchFiles(paths).filter(existsSync)
  const packageHash = digest(await readFile(join(paths.appRoot, 'package.json')))
  const owned = manifest?.state === 'applied' && manifest.appRoot === paths.appRoot
    && manifest.packageHash === packageHash && status.signature && status.proxy
    && files.length === manifest.entries.length
    && files.every(file => manifest.entries.some(entry => entry.file === file))
    && manifest.entries.every(entry => digest(readFileSync(entry.file)) === entry.patchedHash)
  if (!owned) await assertCleanInstallation(paths, manifest)
  const plan = await prepareLocalization(paths, localize, catalog, owned ? manifest : undefined)
  if (plan.record.state === 'unsupported')
    log(`Cursor ${paths.cursorVersion} localization skipped: original file hashes do not match the bundled translation. Model routing remains available.`)
  const previousHashes = new Map(files.map(file => [file, digest(readFileSync(file))]))
  await snapshotTransaction(files, directory, async () => {
    // Apply to clean originals before the normal patcher. Never layer translations on injected code.
    await writeLocalizedRenderers(paths, plan)
    patchInject(paths, log)
    patchAlwaysLocal(paths, log)
    patchAgentHost(paths, log)
    if (!owned) { patchProxy39(paths, log); patchKatex(paths, log) }
    localizePickerSelector(paths, plan.record.state === 'enabled', log)
    const verified = cursorStatus({ paths })
    if (!verified.ready) throw new Error(`Cursor hook verification failed: ${JSON.stringify(verified)}`)
    if (digest(readFileSync(join(paths.appRoot, 'package.json'))) !== packageHash) throw new Error('Cursor changed version during setup.')
  }, { appRoot: paths.appRoot, version: paths.cursorVersion, packageHash, localization: plan.record }, !!owned)
  const changed = files.some(file => digest(readFileSync(file)) !== previousHashes.get(file))
  log(changed ? 'Cursor hooks and interface preference updated. Fully quit and reopen Cursor to load the changes.' : 'Cursor hooks are ready; interface preference recorded.')
  return { ...cursorStatus({ paths }), changed, localization: plan.record }
}

async function assertCleanInstallation(paths: CursorPaths, manifest?: Snapshot, requireChecksums = false) {
  const files = cursorPatchFiles(paths).filter(existsSync)
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
  const checked = new Set<string>()
  for (const [relative, expected] of Object.entries(product.checksums ?? {})) {
    const file = join(paths.appRoot, 'out', relative)
    if (!files.includes(file)) continue
    const actual = createHash('sha256').update(await readFile(file)).digest('base64').replace(/=+$/, '')
    if (actual !== expected) throw new Error(`Cursor checksum mismatch (possibly an update in progress): ${file}. No files were changed.`)
    checked.add(pathIdentity(file))
  }
  // Cursor 3.27 ships no Glass checksum. Its bytes must still match the verified
  // same-version snapshot; require the two stable checksums present in real releases.
  if (requireChecksums && [paths.workbenchJs, paths.extensionHostJs]
    .some(file => !checked.has(pathIdentity(file))))
    throw new Error('Interrupted setup lacks the required Cursor baseline checksums; automatic recovery was refused.')
}
