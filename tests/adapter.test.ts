import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agent, connect } from '../agent.mjs'
import { toProviders, readConnection } from '../src/connection'
import { restoreSnapshot, snapshotTransaction } from '../src/setup'

const folders: string[] = []
afterEach(async () => { for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function temporary() { const dir = await mkdtemp(join(tmpdir(), 'magpie-ccursor-test-')); folders.push(dir); return dir }
const input = {
  gateway: { v1: 'http://127.0.0.1:3000/v1', key: 'fixture-key' },
  models: [{ id: 'fixture/model', name: 'Fixture', context: 120000, output: 16000, images: true, efforts: ['low', 'medium', 'high'] }],
}

describe('Magpie Agent contract', () => {
  test('connect maps routed IDs, gateway key, images, limits and efforts', () => {
    expect(agent.id).toBe('ccursor')
    expect(agent.config).toBe('~/.magpie-ccursor/connection.json')
    const connection = connect(input)
    expect(connection.apiKey).toBe(input.gateway.key) // plugged.go's connection ownership marker
    expect(typeof connection.apiKey).toBe('string')
    const config = toProviders(connection)!
    expect(config.providers[0].baseUrl).toBe(input.gateway.v1)
    expect(config.providers[0].auth.value).toBe('fixture-key')
    expect(config.providers[0].models[0]).toMatchObject({ id: 'fixture/model', apiModel: 'fixture/model', thinkingLevel: 'medium', supportsImages: true, contextTokenLimit: 120000, maxOutputTokens: 16000 })
  })
  test('disconnected agents have no usable provider and missing config is normal', async () => {
    expect(toProviders(null)).toBeNull()
    expect(toProviders({ enabled: false, ...input })).toBeNull()
    expect(await readConnection(await temporary())).toBeNull()
  })
  test('malformed credentials and duplicate models fail closed', () => {
    expect(() => toProviders({ enabled: true, gateway: { ...input.gateway, v1: 'file:///etc/passwd' }, models: input.models })).toThrow()
    expect(() => toProviders({ ...connect(input), models: [...input.models, ...input.models] })).toThrow()
    expect(() => connect({ ...input, models: undefined })).toThrow()
  })
  test('an Agent can connect before model assignment and later receive models', () => {
    expect(toProviders(connect({ ...input, models: [] }))!.providers[0].models).toEqual([])
    expect(toProviders(connect(input))!.providers[0].models).toHaveLength(1)
  })
  test('unsupported effort names do not enable broken reasoning', () => {
    const result = toProviders(connect({ ...input, models: [{ id: 'fixture/plain', efforts: ['turbo'] }] }))!
    expect(result.providers[0].models[0].thinking).toBe(false)
  })
})

describe('Cursor patch snapshot', () => {
  test('failed setup restores all original bytes and preserves backups', async () => {
    const dir = await temporary(), file = join(dir, 'app.js')
    await writeFile(file, 'original')
    await expect(snapshotTransaction([file], dir, async () => { await writeFile(file, 'partial'); throw new Error('fixture failure') })).rejects.toThrow('fixture failure')
    expect(await readFile(file, 'utf8')).toBe('original')
    expect(JSON.parse(await readFile(join(dir, 'patch-manifest.json'), 'utf8')).state).toBe('rolled-back')
  })
  test('successful setup is restorable and idempotent', async () => {
    const dir = await temporary(), file = join(dir, 'app.js')
    await writeFile(file, 'original')
    await snapshotTransaction([file], dir, () => writeFile(file, 'patched'))
    await restoreSnapshot(dir)
    await restoreSnapshot(dir)
    expect(await readFile(file, 'utf8')).toBe('original')
  })
  test('interrupted multi-file restore can resume safely', async () => {
    const dir = await temporary(), first = join(dir, 'a.js'), second = join(dir, 'b.js')
    await writeFile(first, 'original-a'); await writeFile(second, 'original-b')
    await snapshotTransaction([first, second], dir, async () => { await writeFile(first, 'patched-a'); await writeFile(second, 'patched-b') })
    await writeFile(first, 'original-a') // Simulate failure after restoring the first file.
    await restoreSnapshot(dir)
    expect(await readFile(first, 'utf8')).toBe('original-a')
    expect(await readFile(second, 'utf8')).toBe('original-b')
  })
  test('restore refuses to overwrite a later Cursor update', async () => {
    const dir = await temporary(), file = join(dir, 'app.js')
    await writeFile(file, 'original')
    await snapshotTransaction([file], dir, () => writeFile(file, 'patched'))
    await writeFile(file, 'updated by user')
    await expect(restoreSnapshot(dir)).rejects.toThrow('Cursor changed')
    expect(await readFile(file, 'utf8')).toBe('updated by user')
  })
})
