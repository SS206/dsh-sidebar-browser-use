import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'mcp', 'server.js');

const client = new Client({ name: 'browser-use-smoke', version: '0.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'inherit' });
await client.connect(transport);

const listed = await client.listTools(undefined, { cacheMode: 'refresh' });
console.log('TOOLS:', listed.tools.map((tool) => tool.name).join(', '));

const catalog = await client.callTool({ name: 'browser_use_list', arguments: {} });
const text = catalog.content?.find((part) => part.type === 'text')?.text ?? '';
const parsed = JSON.parse(text);
console.log('CATALOG TOOLS:', parsed.tools.map((tool) => tool.name + '/' + tool.kind).join(', '));

const unknown = await client.callTool({ name: 'browser_use_call', arguments: { tool: 'nope' } });
const unknownText = unknown.content?.find((part) => part.type === 'text')?.text ?? '';
console.log('UNKNOWN:', JSON.stringify(JSON.parse(unknownText)));
console.log('UNKNOWN isError:', unknown.isError === true);

const offline = await client.callTool({ name: 'browser_use_call', arguments: { tool: 'browser_navigate', args: { url: 'https://example.com' } } });
const offlineText = offline.content?.find((part) => part.type === 'text')?.text ?? '';
console.log('OFFLINE:', JSON.stringify(JSON.parse(offlineText)));
console.log('OFFLINE isError:', offline.isError === true);

await client.close();
