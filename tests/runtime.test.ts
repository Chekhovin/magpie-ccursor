import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { Database } from 'bun:sqlite'
import { fromJson, toBinary, toJson } from '@bufbuild/protobuf'
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-node'
import { startRuntime } from '../src/runtime'
import { getAgentDatabase, resolveAgentDatabasePath } from '../vendor/server/database/sqlite'
import { AgentClientMessageSchema, AgentServerMessageSchema, AgentService } from '../vendor/server/gen/agent_v1_pb'
import { BidiService } from '../vendor/server/gen/aiserver_v1_pb'
import { cacheBlob, getCachedBlob } from '../vendor/server/handlers/agent/blobStore'
import { getWebTools } from '../vendor/server/config/searchConfigStore'
import { loadRoutes } from '../vendor/server/config/routesStore'
import { bumpRefreshSignal } from '../vendor/server/index'
import { getOrCreateSession } from '../vendor/server/handlers/agent/session'
import { resolveProviderRuntime } from '../vendor/server/handlers/llm/providerRuntime'

const dirs: string[] = []
const cleanup: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-runtime-'))
  dirs.push(dir)
  return dir
}
async function runtime(dataDir: string, port = 0) {
  const result = await startRuntime({ dataDir, port })
  cleanup.push(result.stop)
  return { ...result, url: `http://127.0.0.1:${result.port}` }
}
async function providers(dir: string, baseUrl: string, key = 'fixture-key', apiModel = 'fixture-model') {
  await writeFile(join(dir, 'providers.json'), JSON.stringify({ $schemaVersion: 1, providers: [{
    id: 'fixture', name: 'Fixture', type: 'openai-chat', baseUrl,
    auth: { kind: 'apiKey', value: key }, models: [{ id: 'fixture-picker', apiModel, displayName: 'Fixture Model', thinking: false, contextTokenLimit: 32768, maxOutputTokens: 256, supportsAgent: true }],
  }] }))
}
async function modelList(url: string) {
  const response = await fetch(`${url}/aiserver.v1.AiService/AvailableModels`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' }, body: '{}',
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('x-magpie-ccursor-catalog')).toBe('1')
  expect(response.headers.get('access-control-expose-headers')).toContain('x-magpie-ccursor-catalog')
  return response.json()
}
async function until(check: () => boolean | Promise<boolean>, timeout = 7000) {
  const deadline = Date.now() + timeout
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Condition timed out')
    await Bun.sleep(40)
  }
}
function mockOpenAI() {
  const calls: Array<{ path: string, auth: string | null, body: any }> = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    calls.push({ path: new URL(req.url).pathname, auth: req.headers.get('authorization'), body: await req.json() })
    const chunks = [
      { id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'fixture pong' }, finish_reason: null }] },
      { id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
    ]
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  cleanup.push(() => server.stop(true))
  return { url: `http://127.0.0.1:${server.port}/v1`, calls }
}

test('SQLite prepared bindings, undefined, rollback, serial transactions and restart persistence', async () => {
  const dir = await directory()
  const oldOverride = process.env.BYOK_AGENT_DB_PATH
  process.env.BYOK_AGENT_DB_PATH = join(dir, 'must-not-use.sqlite')
  cleanup.push(() => { if (oldOverride === undefined) delete process.env.BYOK_AGENT_DB_PATH; else process.env.BYOK_AGENT_DB_PATH = oldOverride })
  const first = await runtime(dir)
  expect(resolveAgentDatabasePath()).not.toEndWith('must-not-use.sqlite')
  const db = getAgentDatabase()
  await db.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT)')
  const stmt = db.prepare('INSERT INTO fixture(value) VALUES (?)')
  expect(await stmt.run(['kept'])).toEqual({ lastID: 1, changes: 1 })
  await stmt.finalize()
  expect(await db.get('SELECT * FROM fixture WHERE id = ?', [999])).toBeUndefined()
  expect(await db.get('SELECT value FROM fixture WHERE id = $id', { $id: 1 })).toEqual({ value: 'kept' })
  const order: string[] = []
  const failed = db.transaction(async () => {
    await db.run('INSERT INTO fixture(value) VALUES (?)', ['rolled-back'])
    order.push('first')
    await Bun.sleep(50)
    throw new Error('rollback fixture')
  })
  const committed = db.transaction(async () => {
    order.push('second')
    await db.run('INSERT INTO fixture(value) VALUES (?)', ['committed'])
  })
  const outside = db.run('INSERT INTO fixture(value) VALUES (?)', ['outside'])
  await expect(failed).rejects.toThrow('rollback fixture')
  await committed
  await outside
  expect(order).toEqual(['first', 'second'])
  expect(await db.all('SELECT value FROM fixture ORDER BY id')).toEqual([{ value: 'kept' }, { value: 'committed' }, { value: 'outside' }])
  await first.stop()
  await runtime(dir)
  expect(await getAgentDatabase().get('SELECT count(*) AS n FROM fixture')).toEqual({ n: 3 })
})

test('health identity and HTTP model list use only the selected directory', async () => {
  const dir = await directory()
  await providers(dir, 'http://127.0.0.1:1/v1')
  const first = await runtime(dir)
  expect(first.port).toBeGreaterThan(0)
  expect(await (await fetch(`${first.url}/health`)).json()).toEqual({ ok: true, mode: 'byok', magpieCcursor: true })
  expect(JSON.stringify(await modelList(first.url))).toContain('fixture-picker')
  await first.stop()
  const second = await runtime(await directory())
  expect(JSON.stringify(await modelList(second.url))).not.toContain('fixture-picker')
})

test('restart with another dataDir clears blob and web-tools caches', async () => {
  const firstDir = await directory()
  await writeFile(join(firstDir, 'web-tools.json'), JSON.stringify({ search: { maxResults: 13 } }))
  const first = await runtime(firstDir)
  cacheBlob('directory-private-blob', 'Zmlyc3Q=')
  expect(getCachedBlob('directory-private-blob')).toBe('Zmlyc3Q=')
  expect(getWebTools().search.maxResults).toBe(13)
  await first.stop()
  const secondDir = await directory()
  await writeFile(join(secondDir, 'web-tools.json'), JSON.stringify({ search: { maxResults: 29 } }))
  await runtime(secondDir)
  expect(getCachedBlob('directory-private-blob')).toBeUndefined()
  expect(getWebTools().search.maxResults).toBe(29)
  expect(await getAgentDatabase().get('SELECT * FROM agent_blobs WHERE blob_id = ?', ['directory-private-blob'])).toBeUndefined()
})

test('BidiAppend accepts binary frames and rejects malformed input without a false success ACK', async () => {
  const running = await runtime(await directory())
  const bidi = createClient(BidiService, createConnectTransport({ baseUrl: running.url, httpVersion: '1.1' }))
  const requestId = 'binary-frame'
  const message = fromJson(AgentClientMessageSchema, { clientHeartbeat: {} })
  await bidi.bidiAppend({ requestId: { requestId }, dataBinary: toBinary(AgentClientMessageSchema, message) })
  expect(getOrCreateSession(requestId).messages).toEqual([{ clientHeartbeat: {} }])
  for (const data of ['a', 'not-hex', '0a05ff', 'f80101']) {
    const session = getOrCreateSession('bad-frame')
    await expect(bidi.bidiAppend({ requestId: { requestId: 'bad-frame' }, data })).rejects.toThrow('restart Cursor')
    expect(session.closed).toBe(true)
  }
  await expect(bidi.bidiAppend({ requestId: { requestId: 'no-data' } })).rejects.toThrow('requires requestId')
})

for (const selectedModel of ['fixture-picker', 'default']) {
test(`RunSSE + BidiAppend resolve ${selectedModel} and return OpenAI SSE text`, async () => {
  const mock = mockOpenAI()
  const dir = await directory()
  await providers(dir, mock.url)
  const running = await runtime(dir)
  const transport = createConnectTransport({ baseUrl: running.url, httpVersion: '1.1' })
  const catalog = await modelList(running.url)
  const defaultResponse = await fetch(`${running.url}/aiserver.v1.AiService/GetDefaultModel`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' }, body: '{}',
  })
  expect(defaultResponse.status).toBe(200)
  const defaultModel = (await defaultResponse.json()).model
  expect(defaultModel).toBe('fixture-picker')
  for (const config of [catalog.composerModelConfig, catalog.cmdKModelConfig,
    catalog.backgroundComposerModelConfig, catalog.subagentModelConfigs.explore])
    expect(config.defaultModel).toBe(defaultModel)
  const agent = createClient(AgentService, transport)
  const bidi = createClient(BidiService, transport)
  const requestId = 'fixture-run'
  const message = fromJson(AgentClientMessageSchema, { runRequest: {
    conversationId: 'fixture-conversation', modelDetails: { modelId: selectedModel }, conversationState: {},
    action: { userMessageAction: { userMessage: { text: 'ping', mode: 'AGENT_MODE_AGENT' }, requestContext: {} } },
  } })
  await bidi.bidiAppend({ requestId: { requestId }, appendSeqno: 0n, data: Buffer.from(toBinary(AgentClientMessageSchema, message)).toString('hex') })
  const frames: any[] = []
  for await (const frame of agent.runSSE({ requestId }, { timeoutMs: 10000 })) frames.push(toJson(AgentServerMessageSchema, frame))
  expect(mock.calls.length).toBe(1)
  expect(mock.calls[0].path).toBe('/v1/chat/completions')
  expect(mock.calls[0].auth).toBe('Bearer fixture-key')
  expect(mock.calls[0].body.model).toBe('fixture-model')
  expect(JSON.stringify(mock.calls[0].body.messages)).toContain('ping')
  expect(JSON.stringify(frames)).toContain('fixture pong')
  expect(frames.length).toBeGreaterThan(2)
  expect(await getAgentDatabase().get('SELECT conversation_id FROM conversation_checkpoints WHERE conversation_id = ?', ['fixture-conversation'])).toEqual({ conversation_id: 'fixture-conversation' })
}, 15000)
}

test('stop aborts a received OpenAI request before response data and isolates the next dataDir', async () => {
  const calls: any[] = []
  let disconnected = false
  let release = () => {}
  const upstream = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    calls.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.on('close', () => { disconnected = true })
    // Do not send even headers until the test releases the blocked upstream.
    let released = false
    release = () => {
      if (released) return
      released = true
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'late response' }, finish_reason: null }] }) + '\n\ndata: [DONE]\n\n')
    }
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => {
    release()
    upstream.closeAllConnections()
    return new Promise<void>(resolve => upstream.close(() => resolve()))
  })
  const dir = await directory()
  await providers(dir, `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`)
  const first = await runtime(dir)
  const dbPath = resolveAgentDatabasePath()
  const transport = createConnectTransport({ baseUrl: first.url, httpVersion: '1.1' })
  const agent = createClient(AgentService, transport)
  const bidi = createClient(BidiService, transport)
  const requestId = 'blocked-upstream-run'
  const message = fromJson(AgentClientMessageSchema, { runRequest: {
    conversationId: 'blocked-conversation', modelDetails: { modelId: 'fixture-picker' }, conversationState: {},
    action: { userMessageAction: { userMessage: { text: 'blocked ping', mode: 'AGENT_MODE_AGENT' }, requestContext: {} } },
  } })
  await bidi.bidiAppend({ requestId: { requestId }, appendSeqno: 0n, data: Buffer.from(toBinary(AgentClientMessageSchema, message)).toString('hex') })
  let runSettled = false
  const pending = (async () => {
    try { for await (const _ of agent.runSSE({ requestId })) {} }
    catch { /* Shutdown may close the Connect transport. */ }
    finally { runSettled = true }
  })()
  await until(() => calls.length === 1)
  expect(JSON.stringify(calls[0].messages)).toContain('blocked ping')
  expect(calls[0].model).toBe('fixture-model')
  const session = getOrCreateSession(requestId)
  let stopped = false
  const stopping = first.stop().then(() => { stopped = true })
  try {
    await until(() => stopped && disconnected && runSettled, 2000)
  }
  finally {
    // Bound failure cleanup too: the unfixed implementation awaits upstream data.
    if (!stopped || !disconnected) release()
    await stopping
    await pending
  }
  expect(session.cancelledReason).toBe('runtime stopped')
  const snapshot = (path: string) => {
    const db = new Database(path, { readonly: true })
    try {
      return ['agent_blobs', 'conversation_checkpoints', 'conversation_summaries'].map(table => db.query(`SELECT * FROM ${table} ORDER BY rowid`).all())
    }
    finally { db.close() }
  }
  const oldSnapshot = snapshot(dbPath)
  const mock = mockOpenAI()
  const nextDir = await directory()
  await providers(nextDir, mock.url)
  const next = await runtime(nextDir, first.port)
  const nextPath = resolveAgentDatabasePath()
  const nextSnapshot = snapshot(nextPath)
  release()
  await Bun.sleep(150)
  expect(snapshot(dbPath)).toEqual(oldSnapshot)
  expect(snapshot(nextPath)).toEqual(nextSnapshot)
  expect(calls).toHaveLength(1)
  const nextTransport = createConnectTransport({ baseUrl: next.url, httpVersion: '1.1' })
  await createClient(BidiService, nextTransport).bidiAppend({ requestId: { requestId: 'after-cancel' }, appendSeqno: 0n,
    data: Buffer.from(toBinary(AgentClientMessageSchema, fromJson(AgentClientMessageSchema, { runRequest: {
      conversationId: 'after-cancel-conversation', modelDetails: { modelId: 'fixture-picker' }, conversationState: {},
      action: { userMessageAction: { userMessage: { text: 'restart ping', mode: 'AGENT_MODE_AGENT' }, requestContext: {} } },
    } }))).toString('hex') })
  const frames: any[] = []
  for await (const frame of createClient(AgentService, nextTransport).runSSE({ requestId: 'after-cancel' }, { timeoutMs: 5000 })) frames.push(toJson(AgentServerMessageSchema, frame))
  expect(JSON.stringify(frames)).toContain('fixture pong')
  expect(await getAgentDatabase().get('SELECT conversation_id FROM conversation_checkpoints WHERE conversation_id = ?', ['after-cancel-conversation'])).toEqual({ conversation_id: 'after-cancel-conversation' })
  expect(await getAgentDatabase().get('SELECT conversation_id FROM conversation_checkpoints WHERE conversation_id = ?', ['blocked-conversation'])).toBeUndefined()
  expect(snapshot(dbPath)).toEqual(oldSnapshot)
}, 15000)

test('provider watcher refreshes model mapping, SDK credentials and refresh SSE', async () => {
  const firstMock = mockOpenAI()
  const secondMock = mockOpenAI()
  const dir = await directory()
  await providers(dir, firstMock.url)
  const running = await runtime(dir)
  const oldProvider = resolveProviderRuntime('fixture-picker').provider
  const response = await fetch(`${running.url}/byok/events`)
  const reader = response.body!.getReader()
  cleanup.push(() => reader.cancel())
  await reader.read()
  await providers(dir, secondMock.url, 'changed-key', 'changed-model')
  await until(() => resolveProviderRuntime('fixture-picker').model === 'changed-model')
  const current = resolveProviderRuntime('fixture-picker')
  expect(current.provider).not.toBe(oldProvider)
  const { request } = current.prepareStreamRequest([{ role: 'user', content: 'watcher ping' }], [], 64)
  const events = []
  for await (const event of current.provider.stream(request)) events.push(event)
  expect(secondMock.calls[0].auth).toBe('Bearer changed-key')
  expect(secondMock.calls[0].body.model).toBe('changed-model')
  expect(firstMock.calls).toHaveLength(0)
  expect(events).toContainEqual({ type: 'text_delta', text: 'fixture pong' })
  let text = ''
  await until(async () => {
    const chunk = await reader.read()
    text += new TextDecoder().decode(chunk.value)
    return text.includes('event: refresh')
  })
}, 12000)

test('stop closes occupied SSE streams and allows immediate port reuse', async () => {
  const running = await runtime(await directory())
  const events = await fetch(`${running.url}/byok/events`)
  const logs = await fetch(`${running.url}/byok/log-stream?windowId=9`)
  const readers = [events.body!.getReader(), logs.body!.getReader()]
  for (const reader of readers) await reader.read()
  const start = Date.now()
  await running.stop()
  expect(Date.now() - start).toBeLessThan(2000)
  for (const reader of readers) {
    while (!(await reader.read()).done) {}
  }
  const next = await runtime(await directory(), running.port)
  expect((await fetch(`${next.url}/health`)).status).toBe(200)
})

test('routes watcher pushes updated redirects and stop releases a pending RunSSE', async () => {
  const dir = await directory()
  const running = await runtime(dir)
  const events = await fetch(`${running.url}/byok/events`)
  const reader = events.body!.getReader()
  cleanup.push(() => reader.cancel())
  await reader.read()
  const routes = loadRoutes()
  routes.redirect = ['REST:/fixture-route']
  await writeFile(join(dir, 'routes.json'), JSON.stringify(routes))
  let eventText = ''
  while (!eventText.includes('/fixture-route')) {
    const chunk = await reader.read()
    eventText += new TextDecoder().decode(chunk.value)
  }
  const agent = createClient(AgentService, createConnectTransport({ baseUrl: running.url, httpVersion: '1.1' }))
  const session = getOrCreateSession('pending-stop')
  const pending = (async () => {
    try { for await (const _ of agent.runSSE({ requestId: session.requestId })) {} }
    catch { /* A forcibly closed transport may terminate with a ConnectError. */ }
  })()
  await until(() => session.listeners.size > 0)
  bumpRefreshSignal()
  await running.stop()
  await pending
  expect(session.closed).toBe(true)
  expect(session.cancelledReason).toBe('runtime stopped')
  expect(session.listeners.size).toBe(0)
}, 10000)

test('standalone Bun child exits naturally after stop with watchers and SSE active', async () => {
  const dir = await directory()
  const moduleUrl = new URL('../src/runtime.ts', import.meta.url).href
  const child = Bun.spawn([process.execPath, '-e', `
    import { startRuntime } from ${JSON.stringify(moduleUrl)};
    const runtime = await startRuntime({ dataDir: ${JSON.stringify(dir)}, port: 0 });
    const stream = await fetch('http://127.0.0.1:' + runtime.port + '/byok/events');
    const reader = stream.body.getReader();
    await reader.read();
    await runtime.stop();
    while (!(await reader.read()).done) {}
    console.log('stopped');
  `], { stdout: 'pipe', stderr: 'pipe' })
  cleanup.push(() => { if (child.exitCode === null) child.kill() })
  const exitCode = await child.exited
  const stderr = await new Response(child.stderr).text()
  expect(exitCode, stderr).toBe(0)
  expect(await new Response(child.stdout).text()).toContain('stopped')
}, 7000)

test('EADDRINUSE and early startup failures release database and lifecycle guard', async () => {
  const blocker = createServer()
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => blocker.close(() => resolve())))
  const port = (blocker.address() as { port: number }).port
  const dir = await directory()
  await expect(startRuntime({ dataDir: dir, port })).rejects.toThrow()
  expect(() => getAgentDatabase()).toThrow('Database not initialized')
  const invalid = join(dir, 'file')
  await writeFile(invalid, 'not a directory')
  await expect(startRuntime({ dataDir: invalid, port: 0 })).rejects.toThrow()
  const next = await runtime(dir)
  expect((await fetch(`${next.url}/health`)).status).toBe(200)
})
