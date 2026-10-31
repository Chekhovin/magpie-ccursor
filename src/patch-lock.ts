// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, realpath, readFile, open, link, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'

export class PatchBusyError extends Error {
  readonly code = 'PATCH_BUSY'

  constructor(directory: string, cause?: unknown) {
    super(`Another Cursor setup or restore is in progress, or its lock needs review: ${join(directory, 'patch.lock')}`, { cause })
    this.name = 'PatchBusyError'
  }
}

/** Aliases of the same existing directory must contend for the same kernel lock. */
export async function patchGuardPort(directory: string): Promise<number> {
  const canonical = await realpath(directory)
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical
  return 20000 + createHash('sha256').update(identity).digest().readUInt32BE(0) % 15000
}

async function acquireGuard(directory: string): Promise<Server> {
  const port = await patchGuardPort(directory)
  const server = createServer(socket => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', error => reject(new PatchBusyError(directory, error)))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  return server
}

async function retireDeadOwner(directory: string, path: string): Promise<void> {
  let bytes: Buffer
  try { bytes = await readFile(path) }
  catch (error: any) {
    if (error.code === 'ENOENT') return
    throw new PatchBusyError(directory, error)
  }
  let owner: { pid: number, token: string }
  try {
    owner = JSON.parse(bytes.toString('utf8'))
    if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0 || owner.pid > 0x7fffffff
      || typeof owner.token !== 'string' || !owner.token.trim()) throw new Error('Malformed patch lock owner')
  } catch (error) { throw new PatchBusyError(directory, error) }
  try { process.kill(owner.pid, 0) }
  catch (error: any) {
    if (error.code !== 'ESRCH') throw new PatchBusyError(directory, error)
    // The port guard serializes reapers. A 0.2.5 writer cannot acquire until this
    // file is retired; after that point we only attempt exclusive acquisition once.
    try {
      if (!(await readFile(path)).equals(bytes)) throw new Error('Patch lock owner changed')
      await rename(path, join(directory, `patch.lock.stale-${randomUUID()}`))
    } catch (error) { throw new PatchBusyError(directory, error) }
    return
  }
  throw new PatchBusyError(directory)
}

export async function withPatchLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const guard = await acquireGuard(directory)
  const path = join(directory, 'patch.lock')
  const owner = Buffer.from(JSON.stringify({ pid: process.pid, token: randomUUID() }))
  try {
    await retireDeadOwner(directory, path)
    const temporary = join(directory, `patch.lock.pending-${randomUUID()}`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try { await handle.writeFile(owner); await handle.sync() }
      finally { await handle.close() }
      // A complete record becomes visible atomically. Hard links are exclusive
      // on NTFS as well as POSIX; unsupported filesystems fail closed.
      try { await link(temporary, path) }
      catch (error: any) {
        if (error.code === 'EEXIST') throw new PatchBusyError(directory, error)
        throw error
      }
    } finally { await unlink(temporary) }
    try { return await action() }
    finally {
      // Never remove a replacement lock, including one belonging to an old writer.
      if ((await readFile(path).catch(() => undefined))?.equals(owner)) await unlink(path)
    }
  } finally {
    // Keep the kernel guard until all file-lock cleanup has finished.
    await new Promise<void>((resolve, reject) => guard.close(error => error ? reject(error) : resolve()))
  }
}
