import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRuntime } from '../src/runtime'
import { loadRoutes, requestByokMode } from '../vendor/server/config/routesStore'
import { bumpRefreshSignalForModeChange } from '../vendor/server/index'
import { buildServerConfig } from '../vendor/server/handlers/server/config'
import { Http2Config } from '../vendor/server/gen/aiserver_v1_pb'

const dirs: string[] = [], runtimes: Awaited<ReturnType<typeof startRuntime>>[] = []
const aborts: AbortController[] = []
afterEach(async () => {
  for (const c of aborts.splice(0)) c.abort()
  for (const r of runtimes.splice(0)) await r.stop()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
async function runtime() {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-upstream-0016-')); dirs.push(dir)
  const server = await startRuntime({ dataDir: dir, port: 0 }); runtimes.push(server)
  const url = `http://127.0.0.1:${server.port}`
  return { ...server, dir, url }
}
async function events(url: string) {
  const controller = new AbortController(); aborts.push(controller)
  const response = await fetch(url + '/byok/events', { signal: controller.signal })
  const reader = response.body!.getReader()
  const frames: Array<{ event: string, data: unknown }> = []
  let buffer = ''
  const decoder = new TextDecoder()
  const consumed = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
          const event = frame.match(/^event: (.+)$/m)?.[1], data = frame.match(/^data: (.+)$/m)?.[1]
          if (event && data) frames.push({ event, data: JSON.parse(data) })
        }
      }
    } catch (e) { if (!controller.signal.aborted) throw e }
  })()
  async function until(check: () => boolean) {
    const end = Date.now() + 7000
    while (!check() && Date.now() < end) await Bun.sleep(20)
    expect(check()).toBe(true)
  }
  return { frames, until, close: async () => { controller.abort(); await consumed } }
}
async function mode(url: string, byokMode: unknown) {
  const response = await fetch(url + '/byok/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ byokMode, source: 'fixture' }) })
  return { status: response.status, body: await response.json() as any }
}

test('3.27 ServerConfig forces HTTP/1.1 and exposes catalog header through cached preflight', async () => {
  const r = await runtime()
  expect(buildServerConfig().http2Config).toBe(Http2Config.FORCE_ALL_DISABLED)
  const response = await fetch(r.url + '/aiserver.v1.ServerConfigService/GetServerConfig', {
    method: 'POST', headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' }, body: '{}',
  })
  expect(response.status).toBe(200)
  expect((await response.json() as any).http2Config).toBe('HTTP2_CONFIG_FORCE_ALL_DISABLED')
  const preflight = await fetch(r.url + '/aiserver.v1.AiService/AvailableModels', {
    method: 'OPTIONS', headers: { origin: 'vscode-file://vscode-app', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,connect-protocol-version' },
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('access-control-max-age')).toBe('600')
})

test('BYOK target mode is idempotent and SSE publishes REST plus RPC routes before refreshed models', async () => {
  const r = await runtime(), stream = await events(r.url)
  await stream.until(() => stream.frames.some(f => f.event === 'rpc-routes'))
  const rpc = stream.frames.find(f => f.event === 'rpc-routes')!.data as string[]
  expect(rpc.some(rule => rule.includes('AiService'))).toBe(true)
  expect(rpc.some(rule => rule.startsWith('REST:'))).toBe(false)
  const first = await mode(r.url, 0)
  expect(first).toEqual({ status: 200, body: { byokMode: 0, changed: true } })
  const saved = await readFile(join(r.dir, 'routes.json'), 'utf8')
  expect((await mode(r.url, 0)).body).toEqual({ byokMode: 0, changed: false })
  expect(await readFile(join(r.dir, 'routes.json'), 'utf8')).toBe(saved)
  await stream.until(() => stream.frames.filter(f => f.event === 'rpc-routes').length >= 2)
  const offRules = stream.frames.filter(f => f.event === 'rpc-routes').at(-1)!.data as string[]
  expect(offRules).not.toContain('aiserver.v1.AiService/AvailableModels')
  const before = stream.frames.length
  expect((await mode(r.url, 1)).body).toEqual({ byokMode: 1, changed: true })
  await stream.until(() => stream.frames.slice(before).some(f => f.event === 'refresh'))
  const updates = stream.frames.slice(before)
  expect(updates.findIndex(f => f.event === 'rpc-routes')).toBeLessThan(updates.findIndex(f => f.event === 'refresh'))
  expect(loadRoutes().byokMode).toBe(1)
  await stream.close()
}, 12000)

test('invalid mode never changes routes; queued opposite requests preserve request order', async () => {
  const r = await runtime(), before = await readFile(join(r.dir, 'routes.json'), 'utf8')
  expect((await mode(r.url, 'off')).status).toBe(400)
  expect(await readFile(join(r.dir, 'routes.json'), 'utf8')).toBe(before)
  const result = await Promise.all([requestByokMode(0, 'fixture'), requestByokMode(1, 'fixture')])
  expect(result.map(r => r.routes.byokMode)).toEqual([0, 1])
  expect(loadRoutes().byokMode).toBe(1)
  const toggles = await Promise.all([requestByokMode('toggle', 'legacy'), requestByokMode('toggle', 'legacy')])
  expect(toggles.map(r => r.changed)).toEqual([true, false])
  expect(loadRoutes().byokMode).toBe(0)
})

test('mode-change refresh retries once after settlement and stops all timers across runtime restart', async () => {
  const first = await runtime(), stream = await events(first.url)
  bumpRefreshSignalForModeChange()
  await stream.until(() => stream.frames.filter(f => f.event === 'refresh').length === 2)
  await stream.close()
  bumpRefreshSignalForModeChange()
  await first.stop()
  const next = await runtime(), nextStream = await events(next.url)
  // Ensure the old runtime's pending settle timer cannot publish into the next directory.
  await Bun.sleep(2300)
  expect(nextStream.frames.filter(f => f.event === 'refresh')).toHaveLength(0)
  expect((await requestByokMode('toggle', 'new-directory')).changed).toBe(true)
  await nextStream.close()
}, 12000)
