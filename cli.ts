#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
import { dataDirectory, PORT } from './src/connection'

const command = process.argv[2] || 'help'
try {
  if (command === 'setup' || command === 'restore') {
    if (!process.argv.includes('--cursor-closed'))
      throw new Error('Close all Cursor windows first, then rerun with --cursor-closed. These commands modify Cursor application files.')
    const { setupCursor, restoreSnapshot } = await import('./src/setup')
    if (command === 'setup') await setupCursor()
    else { await restoreSnapshot(); console.log('Plugin patches restored; CCursor data and backups retained.') }
  } else if (command === 'status') {
    const { cursorStatus } = await import('./src/setup')
    const result = { cursor: cursorStatus(), dataDir: dataDirectory(), bridge: 'offline' as any }
    try {
      const health = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.json()) as any
      result.bridge = health.magpieCcursor ? 'magpie-ccursor' : 'another service occupies the port'
    } catch {}
    console.log(JSON.stringify(result, null, 2))
  } else if (command === 'start') {
    await import('./src/daemon')
  } else if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`magpie-ccursor — Cursor ↔ Magpie BYOK bridge

bun cli.ts status                   Inspect hooks and local bridge (no keys shown)
bun cli.ts setup --cursor-closed    Patch a clean Cursor installation with backups
bun cli.ts restore --cursor-closed  Restore only this plugin's patches
bun cli.ts start                    Run bridge in foreground; Ctrl+C to stop

Install the plugin in Magpie with github:Chekhovin/magpie-ccursor.
Connect the CCursor Agent there before starting Cursor.
Source and license: https://github.com/Chekhovin/magpie-ccursor (AGPL-3.0-or-later)`)
  } else throw new Error(`Unknown command: ${command}. Run bun cli.ts --help.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'CCursor command failed.')
  process.exitCode = 1
}
