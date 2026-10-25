/**
 * Internal browser tools exposed through browser_use_call.
 *
 * The model never sees these definitions in its tool list: they only exist in
 * the browser_use_list catalog and in the dispatcher. Keep the catalog small
 * and stable - it is the only place the model learns how to call a tool.
 */

/** @typedef {'read' | 'write'} ToolKind */

/**
 * @typedef {object} ParamSpec
 * @property {'string' | 'number' | 'integer' | 'boolean'} type
 * @property {boolean} [required]
 * @property {string} [description]
 * @property {readonly string[]} [enum]
 * @property {number} [minimum]
 * @property {number} [maximum]
 */

/**
 * @typedef {object} ToolSpec
 * @property {string} name
 * @property {ToolKind} kind
 * @property {string} category
 * @property {string} description
 * @property {Record<string, ParamSpec>} params
 * @property {string} example
 */

/** @type {readonly ToolSpec[]} */
export const INTERNAL_TOOLS = Object.freeze([
  {
    name: 'browser_tabs',
    kind: 'read',
    category: 'inspect',
    description: '列出右侧栏浏览器中当前可见的页面（lease id、URL、标题）。没有页面时返回 NO_BROWSER_TAB。',
    params: {},
    example: 'browser_use_call({ tool: "browser_tabs" })',
  },
  {
    name: 'browser_snapshot',
    kind: 'read',
    category: 'inspect',
    description: '读取当前页面的可交互元素树（a11y 风格）与正文摘要；每个元素带 ref，后续 click/fill 用 ref 定位。ref 只在最近一次 snapshot 内有效。',
    params: {
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
      maxNodes: { type: 'integer', description: '最多返回的节点数，默认 250', minimum: 1, maximum: 1000 },
      selector: { type: 'string', description: '可选的 CSS 选择器，只扫描该子树' },
    },
    example: 'browser_use_call({ tool: "browser_snapshot", args: { maxNodes: 200 } })',
  },
  {
    name: 'browser_text',
    kind: 'read',
    category: 'inspect',
    description: '读取当前页面的纯文本正文（截断）。适合快速阅读文章或表单内容。',
    params: {
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
      maxChars: { type: 'integer', description: '最多返回字符数，默认 3000', minimum: 200, maximum: 20000 },
    },
    example: 'browser_use_call({ tool: "browser_text", args: { maxChars: 4000 } })',
  },
  {
    name: 'browser_screenshot',
    kind: 'read',
    category: 'inspect',
    description: '截取当前页面可视区域，返回 PNG 图片。仅在需要视觉确认时使用，优先用 browser_snapshot。',
    params: {
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
    },
    example: 'browser_use_call({ tool: "browser_screenshot" })',
  },
  {
    name: 'browser_navigate',
    kind: 'write',
    category: 'navigate',
    description: '在当前页面打开一个 http/https URL，并等待加载完成。',
    params: {
      url: { type: 'string', required: true, description: 'http 或 https URL' },
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
    },
    example: 'browser_use_call({ tool: "browser_navigate", args: { url: "https://example.com" } })',
  },
  {
    name: 'browser_click',
    kind: 'write',
    category: 'input',
    description: '点击最近一次 snapshot 中某个 ref 对应的元素（会先滚动到可见位置）。',
    params: {
      ref: { type: 'string', required: true, description: 'snapshot 返回的 ref，例如 e12' },
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
    },
    example: 'browser_use_call({ tool: "browser_click", args: { ref: "e12" } })',
  },
  {
    name: 'browser_fill',
    kind: 'write',
    category: 'input',
    description: '向最近一次 snapshot 中某个 ref 对应的输入框写入文本；submit=true 时随后按下 Enter。',
    params: {
      ref: { type: 'string', required: true, description: 'snapshot 返回的 ref，例如 e3' },
      text: { type: 'string', required: true, description: '要写入的文本，可以为空字符串' },
      submit: { type: 'boolean', description: '写入后是否按 Enter 提交' },
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
    },
    example: 'browser_use_call({ tool: "browser_fill", args: { ref: "e3", text: "hello", submit: true } })',
  },
  {
    name: 'browser_press',
    kind: 'write',
    category: 'input',
    description: '在目标元素或当前焦点元素上按下按键（Enter、Escape、Tab、ArrowDown 等）。',
    params: {
      key: { type: 'string', required: true, description: '按键名，例如 Enter、Escape、Tab、ArrowDown' },
      ref: { type: 'string', description: '可选，snapshot 返回的 ref；省略时发给当前焦点元素' },
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
    },
    example: 'browser_use_call({ tool: "browser_press", args: { key: "Enter" } })',
  },
  {
    name: 'browser_history',
    kind: 'write',
    category: 'navigate',
    description: '页面历史导航：back、forward 或 reload。',
    params: {
      direction: { type: 'string', required: true, enum: ['back', 'forward', 'reload'], description: '导航方向' },
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
    },
    example: 'browser_use_call({ tool: "browser_history", args: { direction: "back" } })',
  },
  {
    name: 'browser_open',
    kind: 'write',
    category: 'navigate',
    description: '在右侧栏新开一个浏览器页面并导航到 http/https URL。',
    params: {
      url: { type: 'string', required: true, description: 'http 或 https URL' },
    },
    example: 'browser_use_call({ tool: "browser_open", args: { url: "https://example.com" } })',
  },
  {
    name: 'browser_eval',
    kind: 'write',
    category: 'debug',
    description: '在当前页面执行一段 JavaScript 并返回 JSON 可序列化结果。默认关闭，仅在配置 allowEvaluate=true 时出现在目录中；即使开启也风险很高。',
    params: {
      script: { type: 'string', required: true, description: '要执行的 JavaScript 表达式或语句' },
      tab: { type: 'string', description: 'webview lease id；省略时用当前可见页' },
    },
    example: 'browser_use_call({ tool: "browser_eval", args: { script: "document.title" } })',
  },
]);

/** @type {ReadonlySet<string>} */
export const READ_TOOLS = Object.freeze(new Set(
  INTERNAL_TOOLS.filter((tool) => tool.kind === 'read').map((tool) => tool.name),
));

/** @type {ReadonlySet<string>} */
export const WRITE_TOOLS = Object.freeze(new Set(
  INTERNAL_TOOLS.filter((tool) => tool.kind === 'write').map((tool) => tool.name),
));

/** @type {ReadonlyMap<string, ToolSpec>} */
export const TOOLS_BY_NAME = Object.freeze(new Map(INTERNAL_TOOLS.map((tool) => [tool.name, tool])));

/**
 * Build the model-facing catalog for browser_use_list.
 *
 * @param {{ allowEvaluate?: boolean }} [options]
 * @returns {{ usage: string, tools: object[], notes: string[] }}
 */
export function buildCatalog(options = {}) {
  const allowEvaluate = options.allowEvaluate === true;
  const tools = INTERNAL_TOOLS
    .filter((tool) => tool.name !== 'browser_eval' || allowEvaluate)
    .map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      category: tool.category,
      description: tool.description,
      args: formatParams(tool.params),
      example: tool.example,
    }));
  return {
    usage: '先用 browser_use_list 获取工具目录，再用 browser_use_call({ tool, args }) 执行。写操作在非 danger-full-access 会话中会触发审批。',
    tools,
    notes: [
      'ref 来自最近一次 browser_snapshot，页面变化后需要重新 snapshot。',
      '没有可见页面时先请用户在右侧栏打开浏览器并输入 http/https 地址，或调用 browser_open。',
      '读操作不审批；写操作（navigate/click/fill/press/history/open/eval）会按会话权限模式决定是否审批。',
      allowEvaluate ? 'browser_eval 已开启：可执行任意页面 JavaScript，请只在你确认安全时使用。' : 'browser_eval 默认关闭。',
    ],
  };
}

/**
 * Format one tool's parameters as a compact, token-friendly string.
 *
 * @param {Record<string, ParamSpec>} params
 * @returns {string}
 */
export function formatParams(params) {
  const entries = Object.entries(params);
  if (entries.length === 0) return '(无参数)';
  return entries
    .map(([name, spec]) => {
      const optional = spec.required === true ? '' : '?';
      const type = spec.enum !== undefined ? spec.enum.join('|') : spec.type;
      return spec.description === undefined
        ? name + optional + ': ' + type
        : name + optional + ': ' + type + ' - ' + spec.description;
    })
    .join('; ');
}

/**
 * Validate call arguments against one tool spec.
 *
 * @param {ToolSpec} tool
 * @param {unknown} rawArgs
 * @returns {{ ok: true, args: Record<string, unknown> } | { ok: false, message: string }}
 */
export function validateArgs(tool, rawArgs) {
  const args = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, message: 'args 必须是对象' };
  }
  const known = new Set(Object.keys(tool.params));
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      return { ok: false, message: '未知参数 "' + key + '"；' + tool.name + ' 允许的参数：' + (known.size === 0 ? '(无)' : [...known].join(', ')) };
    }
  }
  for (const [name, spec] of Object.entries(tool.params)) {
    const value = args[name];
    if (value === undefined || value === null) {
      if (spec.required === true) return { ok: false, message: '缺少必填参数 "' + name + '"' };
      continue;
    }
    const typed = checkType(spec, value);
    if (typed !== undefined) return { ok: false, message: '参数 "' + name + '" ' + typed };
  }
  if (typeof args.url === 'string' && !isHttpUrl(args.url)) {
    return { ok: false, message: 'url 必须是 http:// 或 https:// 开头的地址' };
  }
  if (typeof args.ref === 'string' && !/^e[0-9]+$/u.test(args.ref)) {
    return { ok: false, message: 'ref 形如 e12，来自最近一次 browser_snapshot' };
  }
  return { ok: true, args };
}

/**
 * @param {ParamSpec} spec
 * @param {unknown} value
 * @returns {string | undefined}
 */
function checkType(spec, value) {
  switch (spec.type) {
    case 'string':
      if (typeof value !== 'string') return '必须是字符串';
      if (spec.enum !== undefined && !spec.enum.includes(value)) return '必须是 ' + spec.enum.join('/') + ' 之一';
      return undefined;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : '必须是布尔值';
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是数字';
      if (spec.type === 'integer' && !Number.isInteger(value)) return '必须是整数';
      if (spec.minimum !== undefined && value < spec.minimum) return '不能小于 ' + spec.minimum;
      if (spec.maximum !== undefined && value > spec.maximum) return '不能大于 ' + spec.maximum;
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}
