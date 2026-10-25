import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';

/** Build a minimal Cordis-like host context for the plugin. */
function makeContext() {
  const captured = { route: undefined, fetchRoute: undefined, preExecute: undefined, disposers: [] };
  const ctx = {
    effect(fn) {
      const disposer = fn();
      if (typeof disposer === 'function') captured.disposers.push(disposer);
      return () => disposer?.();
    },
    logger() {
      return { info() {}, warn() {} };
    },
    webServer: {
      port: 19399,
      register(route) {
        captured.route = route;
        return () => {};
      },
    },
    connection: {
      fetch: {
        register(route) {
          captured.fetchRoute = route;
          return () => {};
        },
      },
    },
    on(event, listener) {
      captured.preExecute = listener;
      return () => {};
    },
    get(name) {
      if (name === 'sandboxPolicy') {
        return { resolve: () => ({ mode: 'workspace-write' }) };
      }
      return undefined;
    },
  };
  return { ctx, captured };
}

/** Invoke the captured HTTP bridge route with one JSON body. */
function callBridge(route, { method = 'POST', path = '/browser-use-bridge/rpc', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.url = path;
    req.headers = headers;
    req.destroy = () => {};
    const response = {
      status: undefined,
      headers: undefined,
      body: '',
      writeHead(status, responseHeaders) {
        this.status = status;
        this.headers = responseHeaders;
      },
      end(text) {
        this.body = text;
        resolve({ status: this.status, headers: this.headers, body: this.body });
      },
    };
    route.handler(req, response).catch(reject);
  });
}

/** Invoke the captured browser-fetch route (Connection exact route). */
async function callFetchRoute(route, body) {
  const request = new Request('http://127.0.0.1:19387/api/browser-use', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await route.fetch(request);
  return { status: response.status, json: await response.json() };
}

test('host bridge: token, ping, offline and command round-trip', async () => {
  const home = mkdtempSync(join(tmpdir(), 'browser-use-mcp-host-'));
  process.env.DSH_HOME = home;
  const { ctx, captured } = makeContext();
  try {
    apply(ctx, { allowEvaluate: false, commandTimeoutMs: 2000 });
    const descriptor = JSON.parse(readFileSync(join(home, 'browser-use-mcp', 'bridge.json'), 'utf8'));
    assert.equal(descriptor.port, 19399);
    assert.equal(typeof descriptor.token, 'string');
    assert.equal(descriptor.allowEvaluate, false);
    assert.ok(captured.route, 'bridge route registered');
    assert.ok(captured.fetchRoute, 'renderer fetch route registered');
    assert.equal(captured.fetchRoute.path, '/api/browser-use');
    assert.deepEqual(captured.fetchRoute.methods, ['POST']);
    assert.ok(captured.preExecute, 'approval gate registered');

    const unauthorized = await callBridge(captured.route, { headers: {} });
    assert.equal(unauthorized.status, 401);

    const auth = { authorization: 'Bearer ' + descriptor.token };
    const ping = await callBridge(captured.route, { headers: auth, body: { op: 'ping' } });
    assert.equal(ping.status, 200);
    assert.equal(JSON.parse(ping.body).value.port, 19399);

    const offline = await callBridge(captured.route, { headers: auth, body: { op: 'call', tool: 'browser_tabs', args: {} } });
    assert.equal(offline.status, 400);
    assert.equal(JSON.parse(offline.body).error.code, 'CLIENT_OFFLINE');

    // Bring one renderer client online through the fetch route.
    const poll = await callFetchRoute(captured.fetchRoute, { op: 'poll', clientId: 'client-1', capacity: 4 });
    assert.deepEqual(poll.json, { ok: true, value: { commands: [] } });

    const callPromise = callBridge(captured.route, {
      headers: auth,
      body: { op: 'call', tool: 'browser_click', args: { ref: 'e1' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const polled = await callFetchRoute(captured.fetchRoute, { op: 'poll', clientId: 'client-1', capacity: 4 });
    assert.equal(polled.json.value.commands.length, 1);
    const command = polled.json.value.commands[0];
    assert.equal(command.op, 'browser_click');
    const accepted = await callFetchRoute(captured.fetchRoute, { op: 'result', id: command.id, ok: true, value: { text: 'clicked' } });
    assert.deepEqual(accepted.json, { ok: true, value: { accepted: true } });
    const resolved = await callPromise;
    assert.equal(resolved.status, 200);
    assert.deepEqual(JSON.parse(resolved.body), { ok: true, value: { text: 'clicked' } });

    const missing = await callFetchRoute(captured.fetchRoute, { op: 'result', id: 'missing', ok: true, value: {} });
    assert.deepEqual(missing.json, { ok: true, value: { accepted: false } });
  } finally {
    for (const disposer of captured.disposers) {
      try {
        disposer();
      } catch {
        /* ignore */
      }
    }
    delete process.env.DSH_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('host approval gate asks for writes and allows reads', async () => {
  const home = mkdtempSync(join(tmpdir(), 'browser-use-mcp-host-'));
  process.env.DSH_HOME = home;
  const { ctx, captured } = makeContext();
  try {
    apply(ctx, { allowEvaluate: false });
    const next = () => Promise.resolve({ kind: 'allow' });
    const ask = await captured.preExecute({
      name: 'mcp__browser-use__browser_use_call',
      arguments: { tool: 'browser_navigate', args: { url: 'https://example.com' }, reason: '打开文档' },
      agent: { session: { id: 's1' } },
    }, next);
    assert.equal(ask.kind, 'ask');
    assert.match(ask.reason, /browser_navigate/);
    assert.match(ask.reason, /example\.com/);

    const read = await captured.preExecute({
      name: 'mcp__browser-use__browser_use_call',
      arguments: { tool: 'browser_snapshot', args: {} },
      agent: { session: { id: 's1' } },
    }, next);
    assert.deepEqual(read, { kind: 'allow' });

    const other = await captured.preExecute({ name: 'read', args: {} }, next);
    assert.deepEqual(other, { kind: 'allow' });
  } finally {
    for (const disposer of captured.disposers) {
      try {
        disposer();
      } catch {
        /* ignore */
      }
    }
    delete process.env.DSH_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('an in-flight command keeps the bridge online past the poll TTL', async () => {
  const home = mkdtempSync(join(tmpdir(), 'browser-use-mcp-host-'));
  process.env.DSH_HOME = home;
  const { ctx, captured } = makeContext();
  try {
    apply(ctx, { allowEvaluate: false, commandTimeoutMs: 15000 });
    const descriptor = JSON.parse(readFileSync(join(home, 'browser-use-mcp', 'bridge.json'), 'utf8'));
    const auth = { authorization: 'Bearer ' + descriptor.token };

    await callFetchRoute(captured.fetchRoute, { op: 'poll', clientId: 'client-1', capacity: 4 });
    const slow = callBridge(captured.route, {
      headers: auth,
      body: { op: 'call', tool: 'browser_navigate', args: { url: 'https://example.com' } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const inFlight = await callFetchRoute(captured.fetchRoute, { op: 'poll', clientId: 'client-1', capacity: 4 });
    assert.equal(inFlight.json.value.commands.length, 1);

    await new Promise((resolve) => setTimeout(resolve, 3200));

    const second = callBridge(captured.route, {
      headers: auth,
      body: { op: 'call', tool: 'browser_snapshot', args: {} },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const polledSecond = await callFetchRoute(captured.fetchRoute, { op: 'poll', clientId: 'client-1', capacity: 4 });
    assert.equal(polledSecond.json.value.commands.length, 1, 'second command must be queued, not rejected as offline');
    await callFetchRoute(captured.fetchRoute, { op: 'result', id: polledSecond.json.value.commands[0].id, ok: true, value: { text: 'snap' } });
    const secondResult = await second;
    assert.equal(secondResult.status, 200);

    await callFetchRoute(captured.fetchRoute, { op: 'result', id: inFlight.json.value.commands[0].id, ok: true, value: { text: 'nav' } });
    const slowResult = await slow;
    assert.equal(slowResult.status, 200);
  } finally {
    for (const disposer of captured.disposers) {
      try {
        disposer();
      } catch {
        /* ignore */
      }
    }
    delete process.env.DSH_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});
