import * as acorn from 'acorn';
import { simple } from 'acorn-walk';

const STATE = 'globalThis.__magpieCcursorConnectMode';
const ORIGINAL_GATE = 'readLocalLoopGate(){return this.experimentService.checkFeatureGate("agent_host_local_loop",{disableExposureLog:!0})}';
const PATCHED_GATE = ORIGINAL_GATE.replace('return ', `return ${STATE}===true?false:`);
const START = '/* CURSOR-BYOK-HOOK-START */';
const END = '/* CURSOR-BYOK-HOOK-END */';
const REST_INIT = 'var _restSet=new Set(_restPaths);';
const ROUTES_UPDATE = '_byokEs.addEventListener("routes",function(ev){try{var newPaths=JSON.parse(ev.data);_restPaths=newPaths;_restSet=new Set(newPaths);';
const MODE_UPDATE = `${STATE}=newPaths.indexOf("/auth/poll")!==-1;`;
const PARSE_OPTIONS = { ecmaVersion: 'latest', sourceType: 'module' };

function uniqueOffset(source, text) {
  const offset = source.indexOf(text);
  if (offset < 0 || source.indexOf(text, offset + text.length) !== -1) {
    throw new Error('local-loop: missing or duplicate hook anchor');
  }
  return offset;
}

function inspectGate(source) {
  if (!source.includes('readLocalLoopGate') && !source.includes('agent_host_local_loop')) return null;
  // Tokenize the bundle to distinguish executable methods from strings/comments.
  // Only the small, exact method is parsed; no renderer bundle is executed.
  const tokens = acorn.tokenizer(source, PARSE_OPTIONS);
  let previous, target = null;
  for (const token of tokens) {
    if (token.value === 'readLocalLoopGate' && previous?.type.label !== '.') {
      const text = source.startsWith(PATCHED_GATE, token.start) ? PATCHED_GATE : ORIGINAL_GATE;
      if (token.type.label !== 'name' || !['{', '}', ';'].includes(previous?.type.label)
          || !source.startsWith(text, token.start) || target) {
        throw new Error('local-loop: unknown or duplicate readLocalLoopGate target');
      }
      const ast = acorn.parse(`class Gate{${text}}`, PARSE_OPTIONS);
      if (ast.body[0].body.body[0]?.type !== 'MethodDefinition') {
        throw new Error('local-loop: invalid gate method');
      }
      target = { start: token.start, text, patched: text === PATCHED_GATE };
    }
    previous = token;
  }
  if (!target) throw new Error('local-loop: gate exists but no supported readLocalLoopGate target');
  return target;
}

export function patchLocalLoopGate(source) {
  const target = inspectGate(source);
  if (!target || target.patched) return source;
  return source.slice(0, target.start) + PATCHED_GATE + source.slice(target.start + target.text.length);
}

function inspectHook(payload) {
  const init = uniqueOffset(payload, REST_INIT);
  const update = uniqueOffset(payload, ROUTES_UPDATE) + ROUTES_UPDATE.length;
  const ast = acorn.parse(payload, PARSE_OPTIONS);
  const expression = ast.body.length === 1 && ast.body[0].expression;
  const body = expression?.type === 'CallExpression' && expression.callee?.type === 'FunctionExpression'
    && expression.callee.body.body;
  if (!body || !payload.startsWith('(function(){if(globalThis.__byokReady)return;globalThis.__byokReady=true;')) {
    throw new Error('local-loop: unsupported renderer hook payload');
  }
  if (!body.some(node => node.type === 'VariableDeclaration' && node.start === init && node.end === init + REST_INIT.length)) {
    throw new Error('local-loop: invalid REST initialization anchor');
  }
  let routes = 0;
  simple(ast, {
    CallExpression(node) {
      if (node.callee.type !== 'MemberExpression' || node.callee.object.name !== '_byokEs'
          || node.callee.property.name !== 'addEventListener' || node.arguments[0]?.value !== 'routes') return;
      routes++;
      const handler = node.arguments[1];
      const statements = handler?.body?.body?.[0]?.block?.body;
      if (node.start !== update - ROUTES_UPDATE.length || handler.type !== 'FunctionExpression'
          || handler.body.body.length !== 1 || statements?.[2]?.end !== update) {
        throw new Error('local-loop: unsupported routes handler');
      }
    },
  });
  if (routes !== 1) throw new Error('local-loop: missing or duplicate routes handler');
  const initial = [true, false].map(mode => `${STATE}=${mode};`).find(text => payload.startsWith(text, init + REST_INIT.length));
  const updated = payload.startsWith(MODE_UPDATE, update);
  const occurrences = payload.split(STATE).length - 1;
  if ((initial || updated || occurrences) && !(initial && updated && occurrences === 2)) {
    throw new Error('local-loop: partial or unknown connect-mode helper');
  }
  return { init: init + REST_INIT.length, update, patched: !!initial && updated };
}

/** Reuse the existing routes SSE connection; /auth/poll is exclusive to BYOK mode. */
export function patchLocalLoopHook(payload, connectMode) {
  const hook = inspectHook(payload);
  if (hook.patched) return payload;
  return payload.slice(0, hook.init) + `${STATE}=${connectMode === true};`
    + payload.slice(hook.init, hook.update) + MODE_UPDATE + payload.slice(hook.update);
}

function hookBounds(source) {
  const start = uniqueOffset(source, START);
  const end = uniqueOffset(source, END);
  if (start !== 0 || end < start) throw new Error('local-loop: unsupported hook boundaries');
  return { start: START.length, end };
}

/** Upgrade a complete legacy hook without replacing its payload or transport wrapper. */
export function upgradeLocalLoopHook(source, connectMode) {
  const bounds = hookBounds(source);
  return source.slice(0, bounds.start)
    + patchLocalLoopHook(source.slice(bounds.start, bounds.end), connectMode)
    + source.slice(bounds.end);
}

/** Older renderers with no local-loop gate need no protocol-selection patch. */
export function isLocalLoopCompatible(source) {
  try {
    const gate = inspectGate(source);
    if (!gate) return true;
    if (!gate.patched) return false;
    const bounds = hookBounds(source);
    return inspectHook(source.slice(bounds.start, bounds.end)).patched;
  } catch {
    return false;
  }
}
