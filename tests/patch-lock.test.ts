import { afterEach, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
import { mkdtemp, readFile, readdir, rm, writeFile, symlink, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchGuardPort, PatchBusyError, withPatchLock } from '../src/patch-lock'

const roots: string[] = []
const children: ReturnType<typeof launch>[] = []
type Event = { event: string, name?: string, code?: string, message?: string }
function launch(directory: string, mode = 'hold') {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/patch-lock-process.ts', import.meta.url)), directory, mode], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const events: Event[] = []
  let pending: { resolve: (event: Event) => void, reject: (error: Error) => void } | undefined
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line)
    if (pending) { const waiter = pending; pending = undefined; waiter.resolve(event) }
    else events.push(event)
  })
  let ended = false
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => {
      ended = true
      pending?.reject(new Error(`Fixture exited (${code}): ${errors}`)); pending = undefined
      resolve(code)
    })
  })
  function next(): Promise<Event> {
    if (events.length) return Promise.resolve(events.shift()!)
    if (ended) return Promise.reject(new Error(`Fixture already exited: ${errors}`))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending = undefined; reject(new Error(`Fixture event timeout: ${errors}`)) }, 10000)
      pending = {
        resolve: event => { clearTimeout(timer); resolve(event) },
        reject: error => { clearTimeout(timer); reject(error) },
      }
    })
  }
  const fixture = { child, exit, next, send: (command: string) => child.stdin.write(`${command}\n`) }
  children.push(fixture)
  return fixture
}
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'patch-lock-'))
  roots.push(dir)
  await writeFile(join(dir, 'snapshot-sentinel'), 'unchanged snapshot')
  return dir
}
async function start(dir: string, mode = 'hold') {
  const fixture = launch(dir, mode)
  expect((await fixture.next()).event).toBe('ready')
  fixture.send('go')
  return fixture
}
async function release(fixture: ReturnType<typeof launch>) {
  fixture.send('release')
  expect((await fixture.next()).event).toBe('done')
  expect(await fixture.exit).toBe(0)
}
async function busy(fixture: ReturnType<typeof launch>) {
  expect(await fixture.next()).toMatchObject({ event: 'busy', name: 'PatchBusyError', code: 'PATCH_BUSY' })
  expect(await fixture.exit).toBe(0)
}
async function killOwner(dir: string) {
  const owner = await start(dir)
  expect((await owner.next()).event).toBe('entered')
  const bytes = await readFile(join(dir, 'patch.lock'))
  owner.child.kill('SIGKILL'); await owner.exit
  return bytes
}
async function evidence(dir: string) {
  return (await readdir(dir)).filter(name => name.startsWith('patch.lock.stale-'))
}
afterEach(async () => {
  for (const fixture of children.splice(0)) {
    if (fixture.child.exitCode === null && fixture.child.signalCode === null) fixture.child.kill('SIGKILL')
    await fixture.exit
  }
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true })
})

test('patch-lock returns action values and releases both locks on action failure', async () => {
  const dir = await directory()
  expect(await withPatchLock(dir, async () => 42)).toBe(42)
  const failure = await start(dir, 'throw')
  expect((await failure.next()).event).toBe('entered')
  expect(await failure.next()).toMatchObject({ event: 'error', message: 'Action failed' })
  expect(await failure.exit).toBe(0)
  expect(await readdir(dir)).toEqual(['snapshot-sentinel'])
  expect(await withPatchLock(dir, async () => 'recovered')).toBe('recovered')
  expect(new PatchBusyError(dir)).toBeInstanceOf(Error)
})

test('patch-lock excludes real processes and destroys inbound connections without releasing ownership', async () => {
  const dir = await directory(), owner = await start(dir)
  expect((await owner.next()).event).toBe('entered')
  const original = await readFile(join(dir, 'patch.lock'))
  const port = await patchGuardPort(dir)
  await new Promise<void>((resolve, reject) => {
    const connection = createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => { connection.destroy(); reject(new Error('Guard kept an inbound connection open')) }, 5000)
    connection.on('error', error => { if ((error as any).code !== 'ECONNRESET') reject(error) })
    connection.once('close', () => { clearTimeout(timer); resolve() })
  })
  await busy(await start(dir))
  expect(await readFile(join(dir, 'patch.lock'))).toEqual(original)
  await release(owner)
  const next = await start(dir)
  expect((await next.next()).event).toBe('entered')
  await release(next)
})

test('patch-lock recovers a killed owner and preserves exact stale evidence with unique names', async () => {
  const dir = await directory()
  for (let iteration = 0; iteration < 2; iteration++) {
    const bytes = await killOwner(dir), recovering = await start(dir)
    expect((await recovering.next()).event).toBe('entered')
    const names = await evidence(dir)
    expect(names).toHaveLength(iteration + 1)
    expect((await Promise.all(names.map(name => readFile(join(dir, name))))).some(saved => saved.equals(bytes))).toBe(true)
    await release(recovering)
  }
})

test('patch-lock serializes two real reapers of the same dead owner', async () => {
  const dir = await directory(), bytes = await killOwner(dir)
  const first = launch(dir), second = launch(dir)
  expect((await first.next()).event).toBe('ready')
  expect((await second.next()).event).toBe('ready')
  first.send('go'); second.send('go')
  const results = await Promise.all([first.next(), second.next()])
  expect(results.map(result => result.event).sort()).toEqual(['busy', 'entered'])
  expect(results.find(result => result.event === 'busy')).toMatchObject({ name: 'PatchBusyError', code: 'PATCH_BUSY' })
  const names = await evidence(dir)
  expect(names).toHaveLength(1)
  expect(await readFile(join(dir, names[0]))).toEqual(bytes)
  const winner = results[0].event === 'entered' ? first : second
  expect(JSON.parse(await readFile(join(dir, 'patch.lock'), 'utf8')).pid).toBe(winner.child.pid)
  await release(winner)
  expect(await (winner === first ? second : first).exit).toBe(0)
})

test('patch-lock fails closed on an unrelated listener without retiring or touching files', async () => {
  const dir = await directory(), bytes = await killOwner(dir)
  const listener = await start(dir, 'listener')
  expect((await listener.next()).event).toBe('listening')
  await busy(await start(dir))
  expect(await readFile(join(dir, 'patch.lock'))).toEqual(bytes)
  expect(await evidence(dir)).toEqual([])
  expect(await readFile(join(dir, 'snapshot-sentinel'), 'utf8')).toBe('unchanged snapshot')
  await release(listener)
})

test('patch-lock canonical directory aliases share the port and exclude each other', async () => {
  const dir = await directory(), aliasRoot = await directory(), alias = join(aliasRoot, 'alias')
  await symlink(dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const port = await patchGuardPort(dir)
  expect(port).toBeGreaterThanOrEqual(20000)
  expect(port).toBeLessThan(35000)
  expect(await patchGuardPort(alias)).toBe(port)
  expect(await patchGuardPort(join(dir, '.'))).toBe(port)
  if (process.platform === 'win32') expect(await patchGuardPort(dir.toUpperCase())).toBe(port)
  const owner = await start(dir)
  expect((await owner.next()).event).toBe('entered')
  await busy(await start(alias))
  if (process.platform === 'win32') await busy(await start(dir.toUpperCase()))
  await release(owner)
})

const invalidOwners = [
  '', '{broken', 'null', '[]', '{}',
  ...[0, -1, 1.5, '123', 2147483648, null].map(pid => JSON.stringify({ pid, token: 'invalid' })),
  JSON.stringify({ pid: process.pid }), JSON.stringify({ pid: process.pid, token: '' }),
]
for (const owner of invalidOwners) {
  test(`patch-lock rejects malformed owner ${JSON.stringify(owner)}`, async () => {
    const dir = await directory(), path = join(dir, 'patch.lock')
    await writeFile(path, owner)
    await utimes(path, new Date(0), new Date(0))
    await busy(await start(dir))
    expect(await readFile(path, 'utf8')).toBe(owner)
    expect((await readdir(dir)).sort()).toEqual(['patch.lock', 'snapshot-sentinel'])
    expect(await readFile(join(dir, 'snapshot-sentinel'), 'utf8')).toBe('unchanged snapshot')
  })
}

test('patch-lock never reaps a live legacy owner, regardless of file age', async () => {
  const dir = await directory(), legacy = await start(dir, 'legacy')
  expect((await legacy.next()).event).toBe('entered')
  const path = join(dir, 'patch.lock'), bytes = await readFile(path)
  await utimes(path, new Date(0), new Date(0))
  await busy(await start(dir))
  expect(await readFile(path)).toEqual(bytes)
  expect(await evidence(dir)).toEqual([])
  await release(legacy)
})

test('patch-lock rejects PID probe errors other than ESRCH', async () => {
  const dir = await directory(), bytes = await killOwner(dir)
  await busy(await start(dir, 'probe-error'))
  expect(await readFile(join(dir, 'patch.lock'))).toEqual(bytes)
  expect(await evidence(dir)).toEqual([])
})

test('patch-lock re-reads exact bytes before retiring a stale owner', async () => {
  const dir = await directory()
  await killOwner(dir)
  const contender = await start(dir, 'reread-change')
  await busy(contender)
  expect(JSON.parse(await readFile(join(dir, 'patch.lock'), 'utf8'))).toEqual({ pid: contender.child.pid, token: 'replacement' })
  expect(await evidence(dir)).toEqual([])
})

test('patch-lock preserves a legacy writer that wins the acquisition gap', async () => {
  const dir = await directory(), bytes = await killOwner(dir)
  const contender = await start(dir, 'old-race')
  expect((await contender.next()).event).toBe('gap')
  const legacy = await start(dir, 'legacy')
  expect((await legacy.next()).event).toBe('entered')
  const legacyBytes = await readFile(join(dir, 'patch.lock'))
  contender.send('continue')
  await busy(contender)
  expect(await readFile(join(dir, 'patch.lock'))).toEqual(legacyBytes)
  const names = await evidence(dir)
  expect(names).toHaveLength(1)
  expect(await readFile(join(dir, names[0]))).toEqual(bytes)
  expect(await readFile(join(dir, 'snapshot-sentinel'), 'utf8')).toBe('unchanged snapshot')
  await release(legacy)
})

test('patch-lock holds the kernel guard until file-lock cleanup completes', async () => {
  const dir = await directory(), owner = await start(dir, 'cleanup')
  expect((await owner.next()).event).toBe('entered')
  owner.send('release')
  expect((await owner.next()).event).toBe('cleanup')
  const bytes = await readFile(join(dir, 'patch.lock'))
  await busy(await start(dir))
  expect(await readFile(join(dir, 'patch.lock'))).toEqual(bytes)
  owner.send('continue')
  expect((await owner.next()).event).toBe('done')
  expect(await owner.exit).toBe(0)
  expect(await withPatchLock(dir, async () => 'free')).toBe('free')
})

test('patch-lock cleanup preserves a replacement owner instead of unlinking it', async () => {
  const dir = await directory(), owner = await start(dir)
  expect((await owner.next()).event).toBe('entered')
  const replacement = JSON.stringify({ pid: process.pid, token: 'replacement-owner' })
  await writeFile(join(dir, 'patch.lock'), replacement)
  await release(owner)
  expect(await readFile(join(dir, 'patch.lock'), 'utf8')).toBe(replacement)
  await busy(await start(dir))
  expect(await evidence(dir)).toEqual([])
})

test('patch-lock publishes a complete hard-linked owner and recovers death before temporary cleanup', async () => {
  const dir = await directory(), owner = await start(dir, 'published')
  expect((await owner.next()).event).toBe('published')
  const path = join(dir, 'patch.lock'), bytes = await readFile(path)
  expect(JSON.parse(bytes.toString()).pid).toBe(owner.child.pid)
  const temporary = (await readdir(dir)).find(name => name.startsWith('patch.lock.pending-'))!
  expect(await readFile(join(dir, temporary))).toEqual(bytes)
  expect((await stat(path)).nlink).toBe(2)
  if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  owner.child.kill('SIGKILL'); await owner.exit
  const next = await start(dir)
  expect((await next.next()).event).toBe('entered')
  const names = await evidence(dir)
  expect(names).toHaveLength(1)
  expect(await readFile(join(dir, names[0]))).toEqual(bytes)
  await release(next)
})
