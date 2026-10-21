import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const upstream = process.argv[2]
if (!upstream) throw new Error('Usage: bun scripts/provenance.ts /path/to/fresh-CCursor-clone')
const root = resolve(import.meta.dir, '..')
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')
async function walk(dir: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await walk(path))
    else result.push(path)
  }
  return result
}
const files = []
for (const [local, original] of [['vendor/server', 'Cursor++/src/server'], ['vendor/installer', 'installer/src']]) {
  for (const path of await walk(join(root, local))) {
    const suffix = relative(join(root, local), path)
    const source = join(upstream, original, suffix)
    const upstreamHash = sha256(await readFile(source)), adaptedHash = sha256(await readFile(path))
    files.push({ path: relative(root, path).replaceAll('\\', '/'), upstream: join(original, suffix).replaceAll('\\', '/'), upstreamSha256: upstreamHash, sha256: adaptedHash, modified: upstreamHash !== adaptedHash })
  }
}
await writeFile(join(root, 'docs/upstream-changes.json'), JSON.stringify({ upstream: 'https://github.com/CometixSpace/CCursor', commit: 'fcac85db793fc2c8cda3318b96ec5a41c24f5e26', adapted: '2026-10-21', files }, null, 2) + '\n')
console.log(`Recorded ${files.length} vendored files, ${files.filter(f => f.modified).length} modified.`)
