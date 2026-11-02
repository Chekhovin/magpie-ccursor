import * as filesystem from 'node:fs/promises'
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
const directory = process.argv[2], scenario = process.argv[3]
const path = join(directory, 'state.json')
await filesystem.writeFile(path, '{"previous":true}')
const rename = filesystem.rename
let attempts = 0
const platform = process.platform
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
mock.module('node:fs/promises', () => ({ ...filesystem, rename: async (...args: Parameters<typeof rename>) => {
  attempts++
  if (scenario === 'transient' && attempts > 2) return rename(...args)
  const error: any = new Error('fixture contention')
  error.code = scenario === 'permanent' ? 'EACCES' : 'EPERM'
  throw error
} }))
const { writePrivateJSON } = await import('../../src/connection')
try {
  if (scenario === 'transient') {
    await writePrivateJSON(path, { next: true })
    assert.deepEqual(JSON.parse(await filesystem.readFile(path, 'utf8')), { next: true })
    assert.equal(attempts, 3)
  } else {
    await assert.rejects(() => writePrivateJSON(path, { next: true }), { code: scenario === 'permanent' ? 'EACCES' : 'EPERM' })
    assert.equal(await filesystem.readFile(path, 'utf8'), '{"previous":true}')
    assert.equal(attempts, scenario === 'permanent' ? 1 : 6)
  }
  console.log(JSON.stringify({ scenario, attempts, verified: true }))
} finally { Object.defineProperty(process, 'platform', { value: platform, configurable: true }) }
