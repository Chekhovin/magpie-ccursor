import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { resolveCursorPaths } from '../../src/setup'

// Small valid bundles exercising the upstream AST patchers, without any installed Cursor reads.
export async function createCursorFixture(appRoot: string, version = '3.26.13') {
  await mkdir(appRoot, { recursive: true })
  await writeFile(join(appRoot, 'package.json'), JSON.stringify({ version }))
  const paths = resolveCursorPaths({ appRoot })
  const renderer = `// callback-client.js\nfunction dispatch(service,transport){return [service.Unary,service.ServerStreaming,service.BiDiStreaming,transport]}\nfunction client(service,transport){return dispatch(service,transport)}\nclass AgentCapabilities{readLocalLoopGate(){return this.experimentService.checkFeatureGate("agent_host_local_loop",{disableExposureLog:!0})}}`
  const sources = new Map([
    [paths.workbenchJs, renderer], [paths.glassJs, renderer],
    [paths.alwaysLocalMain, 'exports.activate=function(context){};exports.deactivate=function(){};'],
    [paths.extensionHostJs, 'function validate(s){if(!s.valid)throw Error("signature")}'],
    [paths.agentHostMain, 'var entry=["cursorAgentHostEnabled","registerAgentHostProvider","Activating agent host extension"];exports.activate=function(context){};exports.deactivate=function(){};'],
    [join(paths.agentHostDist, 'network.js'), 'var network=["agent.v1.AgentService","RunSSE","BidiAppend","AiConnectTransportHandler","HTTP/1.1 transport created with network settings","/agent/v1/run","createAgentRunWebSocketSelection"];var gate="nal_websocket_client";var origins=["https://api.playground.cursor.sh","https://api2.cursor.sh"];'],
    [paths.alwaysLocalSingletonJs, 'import{createRequire as req}from"node:module";import * as h from "http";import * as s from "https";install(h),sync(),logger.info("[AlwaysLocalSingleton] proxy-agent patches installed");'],
    [paths.agentHostPackageJson, JSON.stringify({ name: 'cursor-agent-host', publisher: 'anysphere', main: './dist/main.js' })],
  ])
  for (const [file, source] of sources) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, source) }
  const checksums = Object.fromEntries([...sources].filter(([file]) => file.endsWith('.js')).map(([file, source]) => [
    relative(join(appRoot, 'out'), file).replaceAll('\\', '/'), createHash('sha256').update(source).digest('base64').replace(/=+$/, ''),
  ]))
  const product = JSON.stringify({ nameShort: 'Cursor fixture', checksums })
  await writeFile(paths.productJson, product)
  sources.set(paths.productJson, product)
  return { paths, sources }
}

export function sandboxEnvironment(root: string, appRoot = join(root, 'cursor')) {
  return { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, '.config'),
    XDG_CACHE_HOME: join(root, '.cache'), CCURSOR_CURSOR_ROOT: appRoot, MAGPIE_CCURSOR_SKIP_AUTO_SETUP: '0' }
}
