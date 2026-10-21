// Test preload only: delay the first snapshot copy while leaving the real filesystem intact.
import * as filesystem from 'node:fs/promises'
import { mock } from 'bun:test'
const copyFile = filesystem.copyFile
let delayed = false
mock.module('node:fs/promises', () => ({
  ...filesystem,
  copyFile: async (...args: Parameters<typeof copyFile>) => {
    if (!delayed && String(args[1]).includes('backup-')) {
      delayed = true
      await Bun.sleep(5500)
    }
    return copyFile(...args)
  },
}))
