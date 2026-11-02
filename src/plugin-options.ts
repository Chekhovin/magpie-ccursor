// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writePrivateJSON } from './connection'

export function localizationOption(options: unknown): boolean {
  if (options === undefined || options === null) return true
  if (typeof options !== 'object' || Array.isArray(options)) throw new Error('CCursor plugin options must be an object.')
  const value = (options as { localize?: unknown }).localize
  if (value === undefined) return true
  if (typeof value !== 'boolean') throw new Error('CCursor localize option must be true or false.')
  return value
}

export async function readLocalizationOption(dataDir: string) {
  try { return localizationOption(JSON.parse(await readFile(join(dataDir, 'plugin-options.json'), 'utf8'))) }
  catch (error: any) {
    if (error.code === 'ENOENT') return true
    throw new Error(`Cannot read CCursor localization setting: ${error.message}`)
  }
}

export async function saveLocalizationOption(dataDir: string, options: unknown) {
  const localize = localizationOption(options)
  const path = join(dataDir, 'plugin-options.json')
  let previous: string | undefined
  try { previous = await readFile(path, 'utf8') } catch (error: any) { if (error.code !== 'ENOENT') throw error }
  const next = `${JSON.stringify({ localize }, null, 2)}\n`
  if (previous !== next) await writePrivateJSON(path, { localize })
  return localize
}
