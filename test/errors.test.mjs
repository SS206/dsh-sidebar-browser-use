import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BridgeCallError } from '../mcp/bridge-client.js';
import { ToolError, errorContent } from '../mcp/errors.js';

function payloadOf(content) {
  return JSON.parse(content.content[0].text);
}

test('bridge errors keep their code, message and hint', () => {
  const rendered = errorContent(new BridgeCallError('NO_SUCH_REF', 'ref e9 is stale', 'call browser_snapshot again'));
  assert.equal(rendered.isError, true);
  const payload = payloadOf(rendered);
  assert.equal(payload.code, 'NO_SUCH_REF');
  assert.equal(payload.message, 'ref e9 is stale');
  assert.equal(payload.hint, 'call browser_snapshot again');
});

test('tool errors keep their code and hint', () => {
  const payload = payloadOf(errorContent(new ToolError('EVAL_DISABLED', 'eval off', 'enable allowEvaluate')));
  assert.equal(payload.code, 'EVAL_DISABLED');
  assert.equal(payload.hint, 'enable allowEvaluate');
});

test('plain errors fall back to CLIENT_ERROR without a hint', () => {
  const payload = payloadOf(errorContent(new Error('boom')));
  assert.equal(payload.code, 'CLIENT_ERROR');
  assert.equal(payload.hint, undefined);
});
