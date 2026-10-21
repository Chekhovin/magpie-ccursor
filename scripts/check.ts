import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { agent, connect } from '../agent.mjs'

const root = resolve(import.meta.dir, '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const required = [pkg.main, pkg.exports['./server'], pkg.magpie.agent, 'README.md', 'README.en.md', 'LICENSE', 'NOTICE.md']
for (const file of required) if (!(await stat(join(root, file))).isFile()) throw new Error(`Missing package entry: ${file}`)
if (pkg.scripts.postinstall || pkg.scripts.prepare) throw new Error('Installation must not require lifecycle scripts.')
if (agent.id !== 'ccursor' || 'model' in agent) throw new Error('Agent must allow model selection inside Cursor.')
const connection = connect({ gateway: { v1: 'http://127.0.0.1:1/v1', key: 'fixture' }, models: [{ id: 'fixture/model' }] })
if (connection.enabled !== true) throw new Error('Agent connect contract failed.')
const entry = await import('../index.ts')
if (Object.values(entry).filter(v => typeof v === 'function').length !== 1) throw new Error('Host entry must export one plugin function.')
const hook = await entry.default()
if (typeof hook.config !== 'function') throw new Error('Missing config hook.')

async function files(dir: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.pi', 'vendor'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await files(path))
    else result.push(path)
  }
  return result
}
let links = 0
for (const file of await files(root)) {
  if (extname(file) !== '.md') continue
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
    const target = match[1].split('#')[0]
    if (!target || /^[a-z]+:/i.test(target)) continue
    const path = resolve(file, '..', decodeURIComponent(target))
    await stat(path).catch(() => { throw new Error(`Broken link in ${file}: ${target}`) })
    links++
  }
}
console.log(`PASS: package entries, single plugin export, Agent contract, and ${links} relative documentation links.`)
