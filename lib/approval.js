/**
 * Pure approval decision for browser_use_call.
 *
 * Kept free of Cordis types so it can be unit-tested directly. The host half
 * wraps this in a tools/pre-execute listener; DSH then performs the actual
 * approval request with the calling agent.
 */
import { WRITE_TOOLS } from '../mcp/catalog.js';

/**
 * Summarize the concrete target of one write call for the approval card.
 *
 * @param {string} tool
 * @param {unknown} args
 * @returns {string}
 */
export function summarizeTarget(tool, args) {
  const input = args !== null && typeof args === 'object' ? args : {};
  if (typeof input.url === 'string') return input.url;
  if (typeof input.ref === 'string') return 'ref=' + input.ref;
  if (typeof input.direction === 'string') return input.direction;
  if (typeof input.key === 'string') return 'key=' + input.key;
  if (typeof input.script === 'string') return 'script=' + input.script.slice(0, 80);
  return '';
}

/**
 * Decide whether one browser_use_call needs user approval.
 *
 * @param {{ tool: unknown, args: unknown, allowEvaluate: boolean, mode: string | undefined }} input
 * @returns {{ kind: 'ask', reason: string, displayReason: { en: string, zh: string } } | undefined}
 *   undefined means "allow" (fall through to the next pre-execute listener).
 */
export function decideApproval(input) {
  const tool = typeof input.tool === 'string' ? input.tool.trim() : undefined;
  if (tool === undefined || !WRITE_TOOLS.has(tool)) return undefined;
  if (tool === 'browser_eval' && input.allowEvaluate !== true) return undefined;
  if (input.mode === 'danger-full-access') return undefined;
  const detail = summarizeTarget(tool, input.args);
  const purpose = typeof input.purpose === 'string' && input.purpose.trim() !== '' ? '：' + input.purpose.trim() : '';
  return {
    kind: 'ask',
    reason: 'browser_use_call → ' + tool + (detail === '' ? '' : ' (' + detail + ')') + purpose,
    displayReason: {
      en: 'Allow ' + tool + (detail === '' ? '' : ' (' + detail + ')') + ' in the sidebar browser?',
      zh: '允许在侧栏浏览器执行 ' + tool + (detail === '' ? '' : '（' + detail + '）') + ' 吗？',
    },
  };
}
