import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
for (const scenario of ['transient', 'exhausted', 'permanent']) {
  test(`atomic config replacement handles Windows ${scenario} contention without deleting the old file`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'magpie-rename-')); dirs.push(dir)
    const child = Bun.spawnSync([process.execPath, fileURLToPath(new URL('./fixtures/rename-contention.ts', import.meta.url)), dir, scenario], { env: { ...process.env, HOME: dir, USERPROFILE: dir }, timeout: 5000 })
    expect(child.stderr.toString()).toBe('')
    expect(child.exitCode).toBe(0)
    expect(JSON.parse(child.stdout.toString()).verified).toBe(true)
  })
}
