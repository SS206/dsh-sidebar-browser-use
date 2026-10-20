import { buildCatalog, TOOLS_BY_NAME, validateArgs } from './catalog.js';
import { bridgeRequest } from './bridge-client.js';
import { ERROR_CODES, ToolError } from './errors.js';

/**
 * Build the model-facing catalog. Never fails: when the host bridge is not
 * ready the catalog still answers with the default (eval hidden).
 *
 * @param {boolean} allowEvaluate
 * @returns {object}
 */
export function listTools(allowEvaluate) {
  return buildCatalog({ allowEvaluate });
}

/**
 * Dispatch one internal browser tool through the host bridge.
 *
 * @param {unknown} input - raw browser_use_call arguments
 * @param {{ allowEvaluate?: boolean, timeoutMs?: number }} [options]
 * @returns {Promise<object>}
 */
export async function dispatch(input, options = {}) {
  const request = input !== null && typeof input === 'object' ? input : {};
  const tool = typeof request.tool === 'string' ? request.tool.trim() : '';
  if (tool === '') {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, 'tool 必须是非空字符串', '先调用 browser_use_list 获取可用工具名');
  }
  const spec = TOOLS_BY_NAME.get(tool);
  if (spec === undefined) {
    throw new ToolError(
      ERROR_CODES.UNKNOWN_TOOL,
      '未知工具 "' + tool + '"',
      '可用工具：' + [...TOOLS_BY_NAME.keys()].join(', ') + '；先调用 browser_use_list 查看参数',
    );
  }
  if (tool === 'browser_eval' && options.allowEvaluate !== true) {
    throw new ToolError(
      ERROR_CODES.EVAL_DISABLED,
      'browser_eval 在当前配置下未启用',
      '需要宿主配置 allowEvaluate=true；优先使用 snapshot/click/fill 完成操作',
    );
  }
  const validated = validateArgs(spec, request.args);
  if (!validated.ok) {
    throw new ToolError(ERROR_CODES.INVALID_ARGS, validated.message, '参数见 browser_use_list 中 ' + tool + ' 的 args 说明');
  }
  return await bridgeRequest(
    { op: 'call', tool, args: validated.args },
    options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
  );
}
