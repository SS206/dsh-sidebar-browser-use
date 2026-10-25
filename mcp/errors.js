/** Stable error codes surfaced to the model through browser_use_call. */
export const ERROR_CODES = Object.freeze({
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  INVALID_ARGS: 'INVALID_ARGS',
  EVAL_DISABLED: 'EVAL_DISABLED',
  BRIDGE_NOT_READY: 'BRIDGE_NOT_READY',
  CLIENT_OFFLINE: 'CLIENT_OFFLINE',
  NO_BROWSER_TAB: 'NO_BROWSER_TAB',
  TIMEOUT: 'TIMEOUT',
  NO_SUCH_REF: 'NO_SUCH_REF',
  NAVIGATION_BLOCKED: 'NAVIGATION_BLOCKED',
  CLIENT_ERROR: 'CLIENT_ERROR',
});

/**
 * One structured tool failure.
 */
export class ToolError extends Error {
  /**
   * @param {string} code - one of ERROR_CODES
   * @param {string} message - model-facing reason
   * @param {string} [hint] - suggested next action
   */
  constructor(code, message, hint) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.hint = hint;
  }
}

/**
 * Render a ToolError as MCP tool content.
 *
 * @param {ToolError | Error} error
 * @returns {{ content: { type: 'text', text: string }[], isError: true }}
 */
export function errorContent(error) {
  const rawCode = typeof error?.code === 'string' ? error.code : undefined;
  const code = rawCode !== undefined ? rawCode : (error instanceof ToolError ? error.code : ERROR_CODES.CLIENT_ERROR);
  const message = error instanceof Error ? error.message : String(error);
  const hint = typeof error?.hint === 'string' ? error.hint : undefined;
  const payload = { ok: false, code, message, ...hint === undefined ? {} : { hint } };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}
