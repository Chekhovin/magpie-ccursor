// Deterministically stop a disposable CLI after a recovery manifest has been committed.
import * as filesystem from 'node:fs/promises'
import { basename } from 'node:path'
import { mock } from 'bun:test'
const rename = filesystem.rename, readFile = filesystem.readFile, writeFile = filesystem.writeFile, copyFile = filesystem.copyFile
let paused = false
let restoring: any
async function pause() {
  paused = true
  process.stdin.resume()
  process.stdout.write('MANIFEST_PAUSED\n')
  await new Promise(() => {})
}
mock.module('node:fs/promises', () => ({
  ...filesystem,
  rename: async (...args: Parameters<typeof rename>) => {
    await rename(...args)
    if (paused || basename(String(args[1])) !== 'patch-manifest.json') return
    const saved = JSON.parse(await readFile(args[1], 'utf8'))
    if (process.env.PATCH_TEST_PAUSE_STATE === 'restoring-after-copy' && saved.state === 'restoring') {
      restoring = saved
      return
    }
    if (saved.state !== process.env.PATCH_TEST_PAUSE_STATE) return
    if (process.env.PATCH_TEST_CHANGE_TARGET === '1')
      await writeFile(saved.entries[1].file, 'unrecorded change during interrupted patch')
    await pause()
  },
  copyFile: async (...args: Parameters<typeof copyFile>) => {
    await copyFile(...args)
    if (!paused && restoring?.entries.some((e: any) => e.file === args[1] && e.originalHash !== e.patchedHash))
      await pause()
  },
}))
