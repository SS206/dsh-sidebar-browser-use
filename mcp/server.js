/**
 * dsh-browser-use-mcp - stdio MCP server (MCP TypeScript SDK v2, 2026-07-28).
 *
 * The model-facing surface is exactly two tools:
 *   - browser_use_list: returns the internal tool catalog (no side effects);
 *   - browser_use_call: dispatches one internal browser tool.
 *
 * Keeping the surface constant means no tools/list_changed handling, stable
 * prompt caching and a predictable approval point.
 */
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readBridgeDescriptor } from './bridge-client.js';
import { dispatch, listTools } from './dispatch.js';
import { errorContent } from './errors.js';

/** Read host-side options; a missing bridge means "defaults". */
function hostOptions() {
  try {
    return readBridgeDescriptor();
  } catch {
    return { allowEvaluate: false };
  }
}

/**
 * Project one internal result into MCP tool content.
 *
 * The host bridge returns:
 *   { text?: string, data?: unknown, image?: { data: string, mimeType: string } }
 *
 * @param {unknown} value
 * @returns {{ content: object[] }}
 */
function renderResult(value) {
  const result = value !== null && typeof value === 'object' ? value : { data: value };
  const content = [];
  if (typeof result.text === 'string' && result.text !== '') {
    content.push({ type: 'text', text: result.text });
  }
  if (result.image !== undefined && typeof result.image === 'object' && typeof result.image.data === 'string') {
    content.push({
      type: 'image',
      data: result.image.data,
      mimeType: typeof result.image.mimeType === 'string' ? result.image.mimeType : 'image/png',
    });
  }
  if (content.length === 0) {
    content.push({ type: 'text', text: JSON.stringify(result.data ?? null, null, 2) });
  }
  return { content };
}

const LIST_INPUT = fromJsonSchema({
  type: 'object',
  additionalProperties: false,
  properties: {},
});

const CALL_INPUT = fromJsonSchema({
  type: 'object',
  additionalProperties: false,
  required: ['tool'],
  properties: {
    tool: { type: 'string', description: 'Internal tool name returned by browser_use_list' },
    args: { type: 'object', description: 'Arguments object for that tool (see browser_use_list)' },
    reason: { type: 'string', description: 'Optional short reason shown on the approval card' },
  },
});

serveStdio(() => {
  const server = new McpServer(
    { name: 'browser-use', version: '0.1.0' },
    {
      instructions:
        'Call browser_use_list once to learn the internal browser tools, then browser_use_call({ tool, args }) to drive the DSH right-sidebar browser. ' +
        'browser_use_call is the only execution entry; read tools never need approval, write tools ask the user unless the session runs in danger-full-access.',
    },
  );

  server.registerTool(
    'browser_use_list',
    {
      title: 'List browser tools',
      description:
        'Return the catalog of internal browser tools (names, kinds, parameters, examples). Call this before the first browser_use_call. ' +
        'Read tools need no approval; write tools may ask the user for approval outside danger-full-access sessions.',
      inputSchema: LIST_INPUT,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const options = hostOptions();
      return {
        content: [{ type: 'text', text: JSON.stringify(listTools(options.allowEvaluate === true), null, 2) }],
      };
    },
  );

  server.registerTool(
    'browser_use_call',
    {
      title: 'Call a browser tool',
      description:
        'Execute one internal browser tool. Pass the exact tool name returned by browser_use_list plus its args object. ' +
        'Write tools (navigate/click/fill/press/history/open/eval) may trigger a user approval; read tools never do. ' +
        'A ref only stays valid until the next browser_snapshot.',
      inputSchema: CALL_INPUT,
    },
    async (input) => {
      try {
        const options = hostOptions();
        const value = await dispatch(input, { allowEvaluate: options.allowEvaluate === true });
        return renderResult(value);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  return server;
});
