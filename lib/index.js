/**
 * dsh-browser-use-mcp - host half.
 *
 * Responsibilities:
 *   1. own one loopback HTTP bridge for the stdio MCP server (random token,
 *      descriptor in $DSH_HOME/browser-use-mcp/bridge.json);
 *   2. expose the /api/browser-use Connection Fetch route used by the
 *      renderer client half (poll / result);
 *   3. register the tools/pre-execute approval gate for
 *      mcp__browser-use__browser_use_call.
 *
 * It registers no model-facing tools: the MCP server is the only tool surface.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decideApproval } from './approval.js';

export const name = 'browser-use-mcp';
export const inject = ['tools', 'webServer', 'connection'];

/** Connection RPC channel used by the renderer client half. */
const CHANNEL = '/browser-use';
/** HTTP prefix served to the stdio MCP server. */
const ROUTE = '/browser-use-bridge';
/** A client polling within this window counts as online. */
const ONLINE_TTL_MS = 3000;
/** Default per-command deadline towards the renderer. */
const DEFAULT_TIMEOUT_MS = 30000;
/** Hard cap for one bridge request body. */
const MAX_BODY_BYTES = 1_000_000;
/** Public tool name owned by this plugin's MCP server. */
const CALL_TOOL = 'mcp__browser-use__browser_use_call';

/**
 * Resolve the DSH home directory without importing host packages.
 *
 * @returns {string}
 */
function dshHome() {
  return process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
}

/**
 * Read one HTTP request body with a byte cap.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {number} cap
 * @returns {Promise<string>}
 */
function readBody(request, cap) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received > cap) {
        reject(new Error('request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** Build one code-carrying command error. */
function commandError(code, message, hint) {
  const error = new Error(message);
  error.code = code;
  if (hint !== undefined) error.hint = hint;
  return error;
}

/**
 * Host half entry.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ allowEvaluate?: boolean, commandTimeoutMs?: number }} [config]
 */
export function apply(ctx, config = {}) {
  const debugFile = join(dshHome(), 'browser-use-mcp', 'debug.log');
  const dbg = (message) => {
    try {
      mkdirSync(join(dshHome(), 'browser-use-mcp'), { recursive: true });
      appendFileSync(debugFile, new Date().toISOString() + ' ' + message + '\n');
    } catch {
      /* diagnostics must never break the plugin */
    }
  };
  dbg('apply start');
  try {
  const allowEvaluate = config.allowEvaluate === true;
  const commandTimeoutMs = Number.isInteger(config.commandTimeoutMs) && config.commandTimeoutMs > 0
    ? config.commandTimeoutMs
    : DEFAULT_TIMEOUT_MS;
  const bridgeDir = join(dshHome(), 'browser-use-mcp');
  const bridgeFile = join(bridgeDir, 'bridge.json');
  const token = randomUUID();
  const startedAt = Date.now();
  const log = ctx.logger('browser-use-mcp');

  /** @type {{ id: string, op: string, args: object }[]} */
  const pending = [];
  /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
  const inflight = new Map();
  /** @type {Map<string, { lastPollAt: number, sessionId?: string }>} */
  const clients = new Map();
  let disposed = false;

  const port = ctx.webServer.port;
  if (!Number.isInteger(port) || port <= 0) {
    log.warn('webServer port is unavailable; the MCP bridge stays disabled');
  } else {
    mkdirSync(bridgeDir, { recursive: true });
    writeFileSync(
      bridgeFile,
      JSON.stringify({ port, token, pid: process.pid, allowEvaluate, startedAt, commandTimeoutMs, protocolVersion: 1 }, null, 2),
      { mode: 0o600 },
    );
    log.info('bridge listening on 127.0.0.1:' + port + ' (descriptor: ' + bridgeFile + ')');
    dbg('bridge descriptor written, port=' + port);
  }

  /** Reject every parked command so a plugin reload never leaves dangling promises. */
  const rejectInflight = () => {
    for (const [id, entry] of inflight) {
      clearTimeout(entry.timer);
      entry.reject(commandError('CLIENT_ERROR', 'host plugin disposed'));
      inflight.delete(id);
    }
  };

  /** Online check shared by every bridge call. */
  const anyClientOnline = () => {
    if (inflight.size > 0) return true;
    const now = Date.now();
    for (const client of clients.values()) {
      if (now - client.lastPollAt <= ONLINE_TTL_MS) return true;
    }
    return false;
  };

  /**
   * Dispatch one browser command to the renderer and wait for its result.
   *
   * @param {string} op
   * @param {object} args
   * @returns {Promise<unknown>}
   */
  const callRenderer = (op, args) => new Promise((resolve, reject) => {
    if (disposed) return reject(commandError('CLIENT_ERROR', 'host plugin disposed'));
    if (!anyClientOnline()) {
      return reject(commandError(
        'CLIENT_OFFLINE',
        'DSH desktop window is not connected to the browser bridge',
        'keep the DSH window open and retry',
      ));
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      if (!inflight.delete(id)) return;
      reject(commandError(
        'TIMEOUT',
        'browser command timed out after ' + commandTimeoutMs + 'ms',
        'the page may still be loading; retry or take a snapshot first',
      ));
    }, commandTimeoutMs);
    inflight.set(id, { resolve, reject, timer });
    pending.push({ id, op, args: args ?? {} });
  });

  /** Handle one bridge request. */
  const handleBridgeRequest = async (body) => {
    const request = body !== null && typeof body === 'object' ? body : {};
    const op = typeof request.op === 'string' ? request.op : '';
    if (op === 'ping') return { port, allowEvaluate, clients: [...clients.keys()] };
    if (op !== 'call') throw commandError('CLIENT_ERROR', 'unknown bridge op "' + op + '"');
    const tool = typeof request.tool === 'string' ? request.tool : '';
    if (tool === '') throw commandError('CLIENT_ERROR', 'bridge call requires tool');
    return await callRenderer(tool, request.args !== null && typeof request.args === 'object' ? request.args : {});
  };

  // 1) loopback HTTP bridge for the MCP server
  if (Number.isInteger(port) && port > 0) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        const write = (status, payload) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(payload));
        };
        try {
          const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
          if (pathname !== ROUTE + '/rpc') return write(404, { ok: false, error: { code: 'CLIENT_ERROR', message: 'not found' } });
          if (req.method !== 'POST') return write(405, { ok: false, error: { code: 'CLIENT_ERROR', message: 'method not allowed' } });
          if (req.headers.authorization !== 'Bearer ' + token) {
            return write(401, { ok: false, error: { code: 'BRIDGE_NOT_READY', message: 'invalid bridge token' } });
          }
          const raw = await readBody(req, MAX_BODY_BYTES);
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            return write(400, { ok: false, error: { code: 'CLIENT_ERROR', message: 'body is not JSON' } });
          }
          const value = await handleBridgeRequest(body);
          return write(200, { ok: true, value });
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'CLIENT_ERROR';
          const message = error instanceof Error ? error.message : String(error);
          const hint = typeof error?.hint === 'string' ? error.hint : undefined;
          return write(code === 'TIMEOUT' ? 504 : 400, {
            ok: false,
            error: { code, message, ...hint === undefined ? {} : { hint } },
          });
        }
      },
    }), 'browser-use-mcp: bridge route');
    dbg('bridge route registered');
  }

  // 2) renderer channel: an exact Connection Fetch route under /api.
  //    The Connection RPC channel registry is not usable from a third-party
  //    plugin in this composition: rpc.handle() registers through the
  //    Connection service context, which resolves owner.webServer without an
  //    inject declaration and fails the plugin fiber. Exact fetch routes are
  //    owner-neutral and share the /api browser authentication.
  const clientRouteDisposers = [];

  /** Handle one renderer request (poll / result). */
  const handleClientRequest = (payload) => {
    const request = payload !== null && typeof payload === 'object' ? payload : {};
    const endpoint = typeof request.op === 'string' ? request.op : '';
    if (endpoint === 'poll') {
      const clientId = typeof request.clientId === 'string' && request.clientId !== '' ? request.clientId : 'anonymous';
      const capacity = Number.isInteger(request.capacity) && request.capacity > 0 ? Math.min(request.capacity, 16) : 8;
      const previous = clients.get(clientId);
      clients.set(clientId, {
        lastPollAt: Date.now(),
        ...typeof request.sessionId === 'string' ? { sessionId: request.sessionId } : {},
      });
      if (previous === undefined) log.info('renderer client connected: ' + clientId);
      const now = Date.now();
      for (const [id, client] of clients) {
        if (now - client.lastPollAt > 60000) clients.delete(id);
      }
      const commands = [];
      while (commands.length < capacity && pending.length > 0) {
        const command = pending.shift();
        if (inflight.has(command.id)) commands.push(command);
      }
      return { ok: true, value: { commands } };
    }
    if (endpoint === 'result') {
      const id = typeof request.id === 'string' ? request.id : '';
      const entry = inflight.get(id);
      if (entry === undefined) return { ok: true, value: { accepted: false } };
      inflight.delete(id);
      clearTimeout(entry.timer);
      if (request.ok === true) {
        entry.resolve(request.value);
      } else {
        const error = request.error !== null && typeof request.error === 'object' ? request.error : {};
        entry.reject(commandError(
          typeof error.code === 'string' ? error.code : 'CLIENT_ERROR',
          typeof error.message === 'string' ? error.message : 'browser command failed',
          typeof error.hint === 'string' ? error.hint : undefined,
        ));
      }
      return { ok: true, value: { accepted: true } };
    }
    return { ok: false, error: { code: 'CLIENT_ERROR', message: 'unknown client op "' + endpoint + '"' } };
  };

  const clientRouteDisposer = ctx.connection.fetch.register({
    path: '/api/browser-use',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const body = await request.json();
        return Response.json(handleClientRequest(body));
      } catch (error) {
        return Response.json({
          ok: false,
          error: { code: 'CLIENT_ERROR', message: error instanceof Error ? error.message : String(error) },
        }, { status: 400 });
      }
    },
  });
  if (typeof clientRouteDisposer === 'function') clientRouteDisposers.push(clientRouteDisposer);
  dbg('renderer fetch route registered');

  // 3) approval gate for the single MCP execution tool.
  //    Policy: read-only and workspace-write sessions ask the user for every
  //    write tool; danger-full-access sessions skip the prompt.
  ctx.on('tools/pre-execute', async (exec, next) => {
    let argumentDump = '';
    try {
      argumentDump = JSON.stringify(exec.arguments);
    } catch {
      argumentDump = '<unserializable>';
    }
    dbg('pre-execute observed: ' + String(exec.name) + ' arguments=' + String(argumentDump).slice(0, 600));
    if (exec.name !== CALL_TOOL) return next();
    const payload = exec.arguments !== null && typeof exec.arguments === 'object' ? exec.arguments : {};
    let mode;
    try {
      mode = ctx.get('sandboxPolicy')?.resolve({ session: exec.agent?.session }).mode;
    } catch (error) {
      mode = 'unknown';
      dbg('sandboxPolicy resolve failed: ' + String(error));
    }
    const decision = decideApproval({
      tool: payload.tool,
      args: payload.args,
      purpose: payload.reason,
      allowEvaluate,
      mode,
    });
    dbg('approval decision: tool=' + String(payload.tool) + ' mode=' + String(mode) + ' -> ' + (decision === undefined ? 'allow' : decision.kind));
    return decision ?? next();
  });
  dbg('approval gate registered');

  // 4) lifecycle cleanup
  ctx.effect(() => () => {
    disposed = true;
    rejectInflight();
    pending.length = 0;
    for (const dispose of clientRouteDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* best effort */
      }
    }
    try {
      rmSync(bridgeFile, { force: true });
    } catch {
      /* best effort */
    }
  }, 'browser-use-mcp: cleanup');
  dbg('apply complete');
  } catch (error) {
    dbg('apply failed: ' + (error && typeof error === 'object' && 'stack' in error ? String(error.stack) : String(error)));
    throw error;
  }
}
