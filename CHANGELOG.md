# Changelog

## [0.1.0] - 2026-10-20

初始实现，尚未发布。

### Changed

- 2026-10-22：项目/包名重命名为 `dsh-sidebar-browser-use`（原 `dsh-browser-use-mcp`）；运行时插件 id `browser-use-mcp`、MCP server 名 `browser-use`、工具名（`browser_use_*`）与 bridge 数据目录 `$DSH_HOME/browser-use-mcp` 保持不变。
- 2026-10-24：README.md / README.zh.md 精简为面向使用者的最小说明——移除 Status/Install/Approval/Security notes/Development 章节，工具章节标题改为 `Exposed Tools` / `暴露的工具`；实现与验证细节统一保留在 AGENTS.md，安装与回滚见 scripts/。

### Added

- 两工具 MCP 面：`browser_use_list`（目录）与 `browser_use_call`（唯一执行入口）。
- 内部工具：tabs / snapshot / text / screenshot / navigate / click / fill / press / history / open，以及默认关闭的 eval。
- stdio MCP server（@modelcontextprotocol/server 2.3.1）。
- host 半：loopback HTTP bridge（随机 token）、Connection Fetch 路由 `/api/browser-use`、`tools/pre-execute` 审批钩子。
- 审批实现：唯一执行入口 `browser_use_call` 上挂 `tools/pre-execute` 钩子；参数读 `exec.arguments`，会话模式取 `sandboxPolicy.resolve(...).mode`；读工具放行，写工具在 read-only/workspace-write 下返回 `{ kind: 'ask', reason, displayReason }` 弹 DSH 原生审批，danger-full-access 放行；拒绝时调用失败且不执行；`browser_eval` 由 dispatch 的 `allowEvaluate` 门控。
- renderer 半：轮询取命令、可见 webview 定位、a11y 风格快照与 ref、导航/点击/填写/按键/历史/截图。
- 安装/回滚脚本、探针测试与协议测试（18 项）。

### Removed

- 2026-10-23：移除 host 半的临时诊断（`dbg()` 与 `$DSH_HOME/browser-use-mcp/debug.log`），改由标准 DSH logger 输出；该日志会记录所有工具名与参数摘要（含非本插件工具），不适合随发布保留。
- 2026-10-23：删除已被 `test/server.test.mjs` 覆盖的 `test/server-smoke.mjs`（归档于仓库外 `.trash`）。
- 2026-10-23：清理 desktop profile `node_modules` 里指向旧路径的悬空 junction `dsh-browser-use-mcp`。

### Fixed

- 审批绕过：写工具名带空白可绕过 `WRITE_TOOLS` 精确匹配（两侧统一 trim）。
- 错误 hint 丢失：bridge/client 错误的 hint 现在保留到模型侧。
- 长命令执行期间被误判离线：存在 inflight 命令时视为在线。
- 截图无上限与只缩宽度：改为等比缩放 + base64 上限。
- 无历史时 back/forward 挂 25 秒：先检查 canGoBack/canGoForward。
- host 插件无法加载：`ctx.connection.rpc.handle()` 在当前宿主组合下 due to `webServer` inject 检查抛出 → 改用 Connection Fetch 路由。
- 审批钩子不触发：`ctx.effect(() => ctx.on(...))` 包裹无效 → 直接 `ctx.on(...)`。
- 审批读取参数错误：使用 `exec.args` 导致 tool 为 undefined → 改读 `exec.arguments`。
- `browser_history`：goBack/goForward/reload 后等待导航稳定（URL 变化或 did-stop-loading，400ms 宽限），避免返回旧 URL；页面未变化时显式提示。

### Verified

- 2026-10-21 真机验证：浏览器功能全链路（list / tabs / snapshot / text / screenshot / navigate / click / fill+submit / press / history / open）。
- 2026-10-21 真机验证：审批矩阵三模式——read-only / workspace-write 写操作弹审批（拒绝不执行、批准执行），danger-full-access 直接放行，读工具始终不审批；`browser_eval` 默认关闭返回 `EVAL_DISABLED`。
- 2026-10-21 真机验证：`browser_history` 等待修复生效（back 返回新 URL，栈底正确报错）。
- 2026-10-23 发布前复核：`npm test` 18/18、`node --check` 全部通过、`npm pack --dry-run` 通过；诊断代码与冒烟脚本已移除，`lib/index.js` 不再写任何日志文件。

### Known issues

- 侧栏 webview 中页面内导航（链接点击、表单提交）不产生历史条目，`browser_history` 只能回到最近一次 `browser_navigate` 的页面。
- `browser_eval` 在 `allowEvaluate=false` 时审批门放行、由 dispatch 拦截；bridge 路由本身无 eval 门控（本机持有 token 方可越过，属 defense-in-depth 缺口）。
