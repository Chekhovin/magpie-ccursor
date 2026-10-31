// Test-only process fixture: synchronization and fault injection stay out of production.
import { createInterface } from 'node:readline'
import { createServer } from 'node:net'
import * as filesystem from 'node:fs/promises'
import { join } from 'node:path'
import { mock } from 'bun:test'

const [directory, mode = 'hold'] = process.argv.slice(2)
const input = createInterface({ input: process.stdin })
const commands = input[Symbol.asyncIterator]()
const emit = (event: string, detail: object = {}) => console.log(JSON.stringify({ event, ...detail }))
async function command(expected: string) {
  const next = await commands.next()
  if (next.done || next.value !== expected) throw new Error(`Expected command ${expected}, got ${next.value}`)
}
const path = join(directory, 'patch.lock')
const originalLink = filesystem.link
const originalRead = filesystem.readFile
const originalUnlink = filesystem.unlink
const originalWrite = filesystem.writeFile
let reads = 0
if (['old-race', 'published', 'reread-change', 'cleanup'].includes(mode)) {
  mock.module('node:fs/promises', () => ({
    ...filesystem,
    link: async (...args: Parameters<typeof originalLink>) => {
      if (mode === 'old-race' && String(args[1]) === path) {
        emit('gap'); await command('continue')
      }
      await originalLink(...args)
      if (mode === 'published' && String(args[1]) === path) {
        emit('published'); await command('continue')
      }
    },
    readFile: async (...args: any[]) => {
      if (mode === 'reread-change' && String(args[0]) === path && ++reads === 2) {
        await originalWrite(path, JSON.stringify({ pid: process.pid, token: 'replacement' }))
      }
      return (originalRead as any)(...args)
    },
    unlink: async (...args: Parameters<typeof originalUnlink>) => {
      if (mode === 'cleanup' && String(args[0]) === path) {
        emit('cleanup'); await command('continue')
      }
      return originalUnlink(...args)
    },
  }))
}
if (mode === 'probe-error') {
  process.kill = (() => { throw Object.assign(new Error('Probe denied'), { code: 'EPERM' }) }) as typeof process.kill
}
const { withPatchLock, PatchBusyError, patchGuardPort } = await import('../../src/patch-lock')
emit('ready')
try {
  await command('go')
  if (mode === 'listener') {
    const port = await patchGuardPort(directory)
    const server = createServer(socket => socket.destroy())
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
    })
    emit('listening')
    await command('release')
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  } else if (mode === 'legacy') {
    const owner = JSON.stringify({ pid: process.pid, token: 'legacy-writer' })
    const handle = await filesystem.open(path, 'wx', 0o600)
    await handle.writeFile(owner); await handle.close()
    emit('entered')
    await command('release')
    if (await filesystem.readFile(path, 'utf8') === owner) await filesystem.unlink(path)
  } else {
    await withPatchLock(directory, async () => {
      emit('entered')
      if (mode === 'throw') throw new Error('Action failed')
      await command('release')
      return 'result'
    })
  }
  emit('done')
} catch (error: any) {
  emit(error instanceof PatchBusyError ? 'busy' : 'error', { name: error.name, code: error.code, message: error.message })
} finally { input.close(); process.stdin.pause() }
