// SPDX-License-Identifier: AGPL-3.0-or-later
// Byte offsets describe hash-verified, unpatched renderers; never search/replace live code.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export interface LocalizationEdit {
  sourceByteOffset: number, targetByteOffset: number, localizedByteOffset: number,
  before: string, after: string, excluded?: string,
}
export interface LocalizationFile {
  file: string, sourceSha256: string, legacySha256: string, localizedSha256: string,
  replacements: LocalizationEdit[],
}
export interface LocalizationCatalog {
  schemaVersion: number, cursorVersion: string, revision: string, files: LocalizationFile[],
}
export type LocalizationState = 'enabled' | 'disabled' | 'unsupported'
export interface LocalizationRecord { requested: boolean, state: LocalizationState, revision: string }
export const rendererPaths = ['out/vs/workbench/workbench.desktop.main.js', 'out/vs/workbench/workbench.glass.main.js'] as const
export const localizationHash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
let cached: LocalizationCatalog | undefined

export function loadLocalizationCatalog(): LocalizationCatalog {
  cached ??= JSON.parse(readFileSync(fileURLToPath(new URL('../localization/zh-CN.json', import.meta.url)), 'utf8'))
  return cached!
}

export function validateLocalizationCatalog(value: LocalizationCatalog) {
  if (!value || value.schemaVersion !== 1 || !value.revision || !value.cursorVersion || !Array.isArray(value.files)
    || !value.files.length || new Set(value.files.map(f => f.file)).size !== value.files.length)
    throw new Error('Invalid Cursor localization catalog.')
  for (const file of value.files) {
    if (!(rendererPaths as readonly string[]).includes(file.file) || !Array.isArray(file.replacements)
      || ![file.sourceSha256, file.legacySha256, file.localizedSha256].every(h => /^[a-f0-9]{64}$/.test(h)))
      throw new Error('Invalid localization target or baseline hash.')
    let end = 0, legacyDelta = 0, localizedDelta = 0
    for (const edit of file.replacements) {
      if (!edit || typeof edit.before !== 'string' || typeof edit.after !== 'string' || edit.before === edit.after
        || !Number.isSafeInteger(edit.sourceByteOffset) || edit.sourceByteOffset < end
        || edit.targetByteOffset !== edit.sourceByteOffset + legacyDelta
        || edit.localizedByteOffset !== edit.sourceByteOffset + localizedDelta
        || (edit.excluded !== undefined && typeof edit.excluded !== 'string'))
        throw new Error('Invalid or overlapping localization edits.')
      end = edit.sourceByteOffset + Buffer.byteLength(edit.before)
      const delta = Buffer.byteLength(edit.after) - Buffer.byteLength(edit.before)
      legacyDelta += delta
      if (!edit.excluded) localizedDelta += delta
    }
  }
}

function replaceBytes(source: Buffer, edits: Array<{ offset: number, before: string, after: string }>) {
  let offset = 0
  const chunks: Buffer[] = []
  for (const edit of edits) {
    const before = Buffer.from(edit.before), end = edit.offset + before.length
    if (edit.offset < offset || end > source.length || !source.subarray(edit.offset, end).equals(before))
      throw new Error('Localization baseline does not match its recorded byte range.')
    chunks.push(source.subarray(offset, edit.offset), Buffer.from(edit.after))
    offset = end
  }
  chunks.push(source.subarray(offset))
  return Buffer.concat(chunks)
}

export function transformLocalization(source: Buffer, file: LocalizationFile, enabled: boolean): Buffer | undefined {
  const inputHash = localizationHash(source)
  const expected = enabled ? file.localizedSha256 : file.sourceSha256
  if (inputHash === expected) return source
  let english: Buffer
  if (inputHash === file.sourceSha256) english = source
  else if (inputHash === file.legacySha256) {
    english = replaceBytes(source, file.replacements.map(e => ({ offset: e.targetByteOffset, before: e.after, after: e.before })))
  } else if (inputHash === file.localizedSha256) {
    english = replaceBytes(source, file.replacements.filter(e => !e.excluded).map(e => ({ offset: e.localizedByteOffset, before: e.after, after: e.before })))
  } else return undefined
  if (localizationHash(english) !== file.sourceSha256) throw new Error('Localization reverse hash verification failed.')
  const result = enabled ? replaceBytes(english, file.replacements.filter(e => !e.excluded).map(e => ({ offset: e.sourceByteOffset, before: e.before, after: e.after }))) : english
  if (localizationHash(result) !== expected) throw new Error('Localization output hash verification failed.')
  return result
}

// All targets are preflighted from immutable originals before the caller starts its transaction.
export function planLocalization(version: string, sources: Map<string, Buffer>, enabled: boolean,
  catalog = loadLocalizationCatalog()): { record: LocalizationRecord, outputs: Map<string, Buffer> } {
  validateLocalizationCatalog(catalog)
  const outputs = new Map<string, Buffer>()
  const unsupported = () => ({ record: { requested: enabled, state: 'unsupported' as const, revision: catalog.revision }, outputs: new Map<string, Buffer>() })
  if (version !== catalog.cursorVersion) return unsupported()
  for (const file of catalog.files) {
    const source = sources.get(file.file)
    if (!source) return unsupported()
    const result = transformLocalization(source, file, enabled)
    if (!result) return unsupported()
    outputs.set(file.file, result)
  }
  return { record: { requested: enabled, state: enabled ? 'enabled' : 'disabled', revision: catalog.revision }, outputs }
}
