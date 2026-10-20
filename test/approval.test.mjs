import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideApproval, summarizeTarget } from '../lib/approval.js';

const ask = (overrides) => decideApproval({ allowEvaluate: false, mode: 'workspace-write', ...overrides });

test('read tools never ask', () => {
  for (const tool of ['browser_tabs', 'browser_snapshot', 'browser_text', 'browser_screenshot', 'browser_use_list']) {
    assert.equal(ask({ tool }), undefined);
  }
});

test('write tools ask outside danger-full-access', () => {
  for (const mode of ['read-only', 'workspace-write', undefined]) {
    const decision = decideApproval({ tool: 'browser_click', args: { ref: 'e3' }, allowEvaluate: false, mode });
    assert.equal(decision?.kind, 'ask');
    assert.match(decision.reason, /browser_click/);
    assert.match(decision.reason, /e3/);
    assert.ok(decision.displayReason.zh.includes('侧栏浏览器'));
  }
});

test('danger-full-access skips approval', () => {
  assert.equal(decideApproval({ tool: 'browser_navigate', args: { url: 'https://example.com' }, allowEvaluate: false, mode: 'danger-full-access' }), undefined);
});

test('browser_eval follows allowEvaluate before asking', () => {
  assert.equal(decideApproval({ tool: 'browser_eval', args: { script: '1' }, allowEvaluate: false, mode: 'workspace-write' }), undefined);
  assert.equal(decideApproval({ tool: 'browser_eval', args: { script: '1' }, allowEvaluate: true, mode: 'danger-full-access' }), undefined);
  assert.equal(decideApproval({ tool: 'browser_eval', args: { script: '1' }, allowEvaluate: true, mode: 'workspace-write' })?.kind, 'ask');
});

test('purpose text is appended and targets are summarized', () => {
  const decision = decideApproval({
    tool: 'browser_navigate',
    args: { url: 'https://example.com' },
    purpose: '打开文档',
    allowEvaluate: false,
    mode: 'workspace-write',
  });
  assert.match(decision.reason, /https:\/\/example\.com/);
  assert.match(decision.reason, /打开文档/);
  assert.equal(summarizeTarget('browser_history', { direction: 'back' }), 'back');
  assert.equal(summarizeTarget('browser_tabs', {}), '');
});
test('whitespace-padded tool names cannot bypass approval', () => {
  for (const tool of [' browser_navigate ', '\tbrowser_click\t', ' browser_eval ']) {
    const decision = decideApproval({
      tool,
      args: { url: 'https://example.com', ref: 'e1', script: '1' },
      allowEvaluate: true,
      mode: 'workspace-write',
    });
    assert.equal(decision?.kind, 'ask', 'tool ' + JSON.stringify(tool) + ' must ask');
  }
});

