import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
const code = readFileSync(join(import.meta.dir, '../ui/app.js'), 'utf8')
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
async function panel(initial: any = {}, fails = false) {
  const nodes = new Map<string, any>(), writes: any[] = [], timers: Array<() => void> = []
  for (const id of ['enabled', 'status', 'title', 'description', 'restart']) nodes.set(id, { checked: true, disabled: true, textContent: '', setAttribute() {}, addEventListener(_event: string, callback: any) { this.change = callback } })
  let saved = initial, reloads = 0
  const magpie = { ready: Promise.resolve({ lang: 'zh' }), onTheme() {}, options: {
    get: async () => saved,
    set: async (value: any) => { if (fails) throw new Error('fixture write error'); writes.push(value); saved = value; return saved },
  } }
  runInNewContext(code, { document: { getElementById: (id: string) => nodes.get(id) }, magpie,
    window: { location: { reload() { reloads++ } } }, setTimeout: (fn: () => void) => { timers.push(fn) } })
  await flush()
  return { nodes, writes, timers, reloads: () => reloads, setSaved: (value: any) => { saved = value } }
}
test('panel defaults ON without writing/restarting host and saves the actual OFF choice with other options', async () => {
  const p = await panel({ unrelated: 'keep' }), input = p.nodes.get('enabled')
  expect(input.checked).toBe(true); expect(input.disabled).toBe(false); expect(p.writes.length).toBe(0)
  p.setSaved({ unrelated: 'newer' }); input.checked = false
  await input.change(); await flush()
  expect(p.writes).toEqual([{ unrelated: 'newer', localize: false }])
  expect(input.checked).toBe(false); expect(input.disabled).toBe(true)
  expect(p.nodes.get('status').textContent).toContain('设置已保存')
  p.timers.forEach(fn => fn()); expect(input.disabled).toBe(false); expect(p.reloads()).toBe(1)
  input.checked = true; await input.change()
  expect(p.writes.at(-1).localize).toBe(true)
})
test('failed save restores checked state and preserves error feedback', async () => {
  const p = await panel({ localize: false }, true), input = p.nodes.get('enabled')
  input.checked = true; await input.change(); p.timers.forEach(fn => fn())
  expect(input.checked).toBe(false); expect(p.writes.length).toBe(0); expect(p.reloads()).toBe(0)
  expect(p.nodes.get('status').textContent).toContain('保存失败')
})
test('panel is embedded in agents only and uses the official relative bridge with no permissions', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, '../package.json'), 'utf8'))
  expect(pkg.magpie.page).toBeUndefined(); expect(pkg.magpie.permissions).toBeUndefined()
  expect(pkg.magpie.panels[0].slot).toBe('agents')
  const html = readFileSync(join(import.meta.dir, '../ui/localization.html'), 'utf8')
  expect(html).toContain('src="_magpie/bridge.js"'); expect(html).not.toContain('onclick=')
  expect(code).not.toContain('fetch(')
})
