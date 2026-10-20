import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_TOOLS,
  READ_TOOLS,
  TOOLS_BY_NAME,
  WRITE_TOOLS,
  buildCatalog,
  formatParams,
  isHttpUrl,
  validateArgs,
} from '../mcp/catalog.js';

test('catalog hides browser_eval by default and exposes it when allowed', () => {
  const hidden = buildCatalog();
  assert.ok(hidden.tools.every((tool) => tool.name !== 'browser_eval'));
  const visible = buildCatalog({ allowEvaluate: true });
  assert.ok(visible.tools.some((tool) => tool.name === 'browser_eval'));
  assert.equal(visible.tools.length, INTERNAL_TOOLS.length);
});

test('catalog entries stay in sync with the dispatch table', () => {
  const catalog = buildCatalog({ allowEvaluate: true });
  for (const entry of catalog.tools) {
    const spec = TOOLS_BY_NAME.get(entry.name);
    assert.ok(spec, 'missing spec for ' + entry.name);
    assert.equal(entry.kind, spec.kind);
    assert.equal(entry.args, formatParams(spec.params));
  }
  assert.equal(TOOLS_BY_NAME.size, INTERNAL_TOOLS.length);
});

test('read and write tool sets are disjoint and complete', () => {
  assert.equal(READ_TOOLS.size + WRITE_TOOLS.size, INTERNAL_TOOLS.length);
  for (const name of READ_TOOLS) assert.ok(!WRITE_TOOLS.has(name));
});

test('validateArgs rejects missing, unknown, mistyped and unsafe values', () => {
  const navigate = TOOLS_BY_NAME.get('browser_navigate');
  assert.equal(validateArgs(navigate, {}).ok, false);
  assert.equal(validateArgs(navigate, { url: 42 }).ok, false);
  assert.equal(validateArgs(navigate, { url: 'file:///etc/passwd' }).ok, false);
  assert.equal(validateArgs(navigate, { url: 'https://user:pass@example.com' }).ok, false);
  assert.equal(validateArgs(navigate, { url: 'https://example.com', extra: 1 }).ok, false);
  assert.equal(validateArgs(navigate, { url: 'https://example.com' }).ok, true);

  const click = TOOLS_BY_NAME.get('browser_click');
  assert.equal(validateArgs(click, { ref: 'nope' }).ok, false);
  assert.equal(validateArgs(click, { ref: 'e12' }).ok, true);

  const snapshot = TOOLS_BY_NAME.get('browser_snapshot');
  assert.equal(validateArgs(snapshot, { maxNodes: 0 }).ok, false);
  assert.equal(validateArgs(snapshot, { maxNodes: 1.5 }).ok, false);
  assert.equal(validateArgs(snapshot, { maxNodes: 100 }).ok, true);

  const fill = TOOLS_BY_NAME.get('browser_fill');
  assert.equal(validateArgs(fill, { ref: 'e1', text: '' }).ok, true);
  assert.equal(validateArgs(fill, { ref: 'e1', text: 'x', submit: 'yes' }).ok, false);

  const history = TOOLS_BY_NAME.get('browser_history');
  assert.equal(validateArgs(history, { direction: 'left' }).ok, false);
  assert.equal(validateArgs(history, { direction: 'back' }).ok, true);

  const tabs = TOOLS_BY_NAME.get('browser_tabs');
  assert.equal(validateArgs(tabs, undefined).ok, true);
  assert.equal(validateArgs(tabs, { x: 1 }).ok, false);
});

test('isHttpUrl accepts only plain http(s) URLs', () => {
  assert.equal(isHttpUrl('https://example.com/a?b=1'), true);
  assert.equal(isHttpUrl('http://127.0.0.1:8080'), true);
  assert.equal(isHttpUrl('ftp://example.com'), false);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('https://user:pass@example.com'), false);
  assert.equal(isHttpUrl('not a url'), false);
});
