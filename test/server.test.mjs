import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const entry = fileURLToPath(new URL('../mcp/server.js', import.meta.url));

test('stdio MCP surface: exactly two tools, catalog and error mapping', async () => {
  const dshHome = mkdtempSync(join(tmpdir(), 'browser-use-mcp-test-'));
  const client = new Client({ name: 'browser-use-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { ...process.env, DSH_HOME: dshHome },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools(undefined, { cacheMode: 'refresh' });
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ['browser_use_call', 'browser_use_list']);

    const catalogResult = await client.callTool({ name: 'browser_use_list', arguments: {} });
    assert.ok(catalogResult.isError !== true);
    const catalogText = catalogResult.content.find((part) => part.type === 'text').text;
    const catalog = JSON.parse(catalogText);
    assert.ok(catalog.tools.length >= 10);
    assert.ok(catalog.tools.every((tool) => tool.name !== 'browser_eval'));
    assert.equal(catalog.tools.find((tool) => tool.name === 'browser_tabs').kind, 'read');

    const unknown = await client.callTool({ name: 'browser_use_call', arguments: { tool: 'nope' } });
    assert.equal(unknown.isError, true);
    const unknownPayload = JSON.parse(unknown.content.find((part) => part.type === 'text').text);
    assert.equal(unknownPayload.code, 'UNKNOWN_TOOL');

    const invalid = await client.callTool({ name: 'browser_use_call', arguments: { tool: 'browser_navigate', args: { url: 'file:///etc/passwd' } } });
    assert.equal(invalid.isError, true);
    assert.equal(JSON.parse(invalid.content.find((part) => part.type === 'text').text).code, 'INVALID_ARGS');

    const evalDisabled = await client.callTool({ name: 'browser_use_call', arguments: { tool: 'browser_eval', args: { script: '1' } } });
    assert.equal(evalDisabled.isError, true);
    assert.equal(JSON.parse(evalDisabled.content.find((part) => part.type === 'text').text).code, 'EVAL_DISABLED');

    const offline = await client.callTool({ name: 'browser_use_call', arguments: { tool: 'browser_navigate', args: { url: 'https://example.com' } } });
    assert.equal(offline.isError, true);
    assert.equal(JSON.parse(offline.content.find((part) => part.type === 'text').text).code, 'BRIDGE_NOT_READY');
  } finally {
    await client.close().catch(() => {});
    rmSync(dshHome, { recursive: true, force: true });
  }
});
