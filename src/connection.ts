// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const dataDirectory = () => join(homedir(), '.magpie-ccursor')
export const PORT = 39831
const levels = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function toProviders(connection: any) {
  if (connection?.enabled !== true) return null
  const gateway = { v1: connection.baseUrl ?? connection.gateway?.v1, key: connection.apiKey ?? connection.gateway?.key }
  if (typeof gateway?.v1 !== 'string' || typeof gateway?.key !== 'string' || !gateway.key)
    throw new Error('Connect the CCursor Agent in Magpie to supply its gateway credentials.')
  const url = new URL(gateway.v1)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Invalid Magpie gateway URL.')
  if (!Array.isArray(connection.models))
    throw new Error('The CCursor Agent model list is invalid.')
  const seen = new Set<string>()
  const models = connection.models.map((model: any) => {
    if (typeof model.id !== 'string' || !model.id || seen.has(model.id))
      throw new Error('Magpie model IDs must be nonempty and unique.')
    seen.add(model.id)
    const efforts = Array.isArray(model.efforts) ? model.efforts.filter((v: string) => levels.has(v)) : []
    return {
      id: model.id, apiModel: model.id, displayName: model.name || model.id,
      thinking: efforts.length > 0,
      ...(efforts.length ? { thinkingLevel: efforts.includes('medium') ? 'medium' : efforts[0], parameters: { reasoning: efforts } } : {}),
      contextTokenLimit: Number.isFinite(model.context) && model.context > 0 ? model.context : 32768,
      maxOutputTokens: Number.isFinite(model.output) && model.output > 0 ? model.output : 8192,
      supportsAgent: true, supportsImages: model.images === true,
      supportsCmdK: true, supportsMaxMode: true, supportsNonMaxMode: true, defaultOn: true,
    }
  })
  return {
    $schemaVersion: 1,
    providers: [{ id: 'magpie', name: 'Magpie', type: 'openai-chat', baseUrl: gateway.v1.replace(/\/$/, ''),
      auth: { kind: 'apiKey', value: gateway.key }, headers: { 'User-Agent': 'magpie-ccursor/0.2.1' }, models }],
  }
}

export async function readConnection(dataDir: string) {
  try { return JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8')) }
  catch (error: any) { if (error.code === 'ENOENT') return null; throw new Error('Cannot read CCursor connection.json; reconnect the Agent in Magpie.') }
}

export async function writePrivateJSON(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}
