// Pause only this disposable CLI before it acquires the patch guard.
import * as filesystem from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { mock } from 'bun:test'
const mkdir = filesystem.mkdir
let paused = false
mock.module('node:fs/promises', () => ({
  ...filesystem,
  mkdir: async (...args: Parameters<typeof mkdir>) => {
    if (!paused && resolve(String(args[0])) === resolve(process.env.PATCH_TEST_DATA!)) {
      paused = true
      process.stdin.resume()
      process.stdout.write('BEFORE_GUARD\n')
      await new Promise<void>(done => process.stdin.once('data', () => done()))
    }
    return mkdir(...args)
  },
}))
const { setupCursor } = await import('../../src/setup')
try {
  await setupCursor({ dataDir: process.env.PATCH_TEST_DATA, appRoot: process.env.CCURSOR_CURSOR_ROOT, automatic: true, log: () => {} })
  process.stdout.write('SETUP_COMPLETED\n')
} catch (error: any) {
  process.stdout.write(`${error.name}\n`)
} finally { process.stdin.pause() }
