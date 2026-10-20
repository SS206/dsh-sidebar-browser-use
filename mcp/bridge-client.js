import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolve the bridge directory shared with the host plugin. */
export function bridgeDirectory() {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
  return join(home, 'browser-use-mcp');
}

/** Resolve the bridge descriptor path. */
export function bridgeFile() {
  return join(bridgeDirectory(), 'bridge.json');
}

/**
 * Read the current host-bridge descriptor.
 *
 * The host rewrites this file on every boot: a new random token invalidates
 * every stale reader automatically.
 *
 * @returns {{ port: number, token: string, pid: number, allowEvaluate: boolean }}
 * @throws {Error} when the descriptor is missing or malformed
 */
export function readBridgeDescriptor() {
  const file = bridgeFile();
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error('host bridge is not ready (' + file + '): ' + (error instanceof Error ? error.message : String(error)));
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('host bridge descriptor is malformed');
  const { port, token, pid, allowEvaluate, commandTimeoutMs } = parsed;
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('host bridge descriptor has an invalid port');
  if (typeof token !== 'string' || token.length === 0) throw new Error('host bridge descriptor has an invalid token');
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) throw new Error('host bridge descriptor has an invalid pid');
  return {
    port,
    token,
    pid,
    allowEvaluate: allowEvaluate === true,
    commandTimeoutMs: Number.isInteger(commandTimeoutMs) && commandTimeoutMs > 0 ? commandTimeoutMs : undefined,
  };
}

/**
 * POST one request to the host bridge.
 *
 * @param {object} request
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<unknown>}
 */
export async function bridgeRequest(request, options = {}) {
  let descriptor;
  try {
    descriptor = readBridgeDescriptor();
  } catch (error) {
    throw new BridgeCallError('BRIDGE_NOT_READY', error instanceof Error ? error.message : String(error), 'DSH host plugin has not started yet; retry in a moment');
  }
  const timeoutMs = options.timeoutMs
    ?? (descriptor.commandTimeoutMs !== undefined ? descriptor.commandTimeoutMs + 5000 : 45000);
  let response;
  try {
    response = await fetch('http://127.0.0.1:' + descriptor.port + '/browser-use-bridge/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + descriptor.token,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new BridgeCallError('TIMEOUT', 'host bridge request timed out after ' + timeoutMs + 'ms', 'the page may still be loading; retry or take a snapshot first');
    }
    throw new BridgeCallError('BRIDGE_NOT_READY', 'cannot reach the DSH host bridge: ' + (error instanceof Error ? error.message : String(error)), 'restart DSH if this persists');
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new BridgeCallError('CLIENT_ERROR', 'host bridge returned a non-JSON response (HTTP ' + response.status + ')');
  }
  if (response.status === 401 || response.status === 403) {
    throw new BridgeCallError('BRIDGE_NOT_READY', 'host bridge rejected the session token; DSH may have restarted', 'retry after DSH finishes starting');
  }
  if (body === null || typeof body !== 'object' || body.ok !== true) {
    const error = body !== null && typeof body === 'object' && body.error !== undefined ? body.error : undefined;
    throw new BridgeCallError(
      typeof error?.code === 'string' ? error.code : 'CLIENT_ERROR',
      typeof error?.message === 'string' ? error.message : 'host bridge request failed (HTTP ' + response.status + ')',
      typeof error?.hint === 'string' ? error.hint : undefined,
    );
  }
  return body.value;
}

/** Error carrying one of the model-facing error codes. */
export class BridgeCallError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {string} [hint]
   */
  constructor(code, message, hint) {
    super(message);
    this.name = 'BridgeCallError';
    this.code = code;
    this.hint = hint;
  }
}
