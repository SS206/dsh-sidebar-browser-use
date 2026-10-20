# Changelog

## [0.1.0] - 2026-10-20

初始实现，尚未发布。

### Added

- 两工具 MCP 面：`browser_use_list`（目录）与 `browser_use_call`（唯一执行入口）。
- 内部工具：tabs / snapshot / text / screenshot / navigate / click / fill / press / history / open，以及默认关闭的 eval。
- stdio MCP server（@modelcontextprotocol/server 2.3.1）。
- host 半：loopback HTTP bridge（随机 token）、Connection Fetch 路由 `/api/browser-use`、`tools/pre-execute` 审批钩子。
- renderer 半：轮询取命令、可见 webview 定位、a11y 风格快照与 ref、导航/点击/填写/按键/历史/截图。
- 安装/回滚脚本、探针测试与协议测试（18 项）。

### Fixed

- 审批绕过：写工具名带空白可绕过 `WRITE_TOOLS` 精确匹配（两侧统一 trim）。
- 错误 hint 丢失：bridge/client 错误的 hint 现在保留到模型侧。
- 长命令执行期间被误判离线：存在 inflight 命令时视为在线。
- 截图无上限与只缩宽度：改为等比缩放 + base64 上限。
- 无历史时 back/forward 挂 25 秒：先检查 canGoBack/canGoForward。
- host 插件无法加载：`ctx.connection.rpc.handle()` 在当前宿主组合下 due to `webServer` inject 检查抛出 → 改用 Connection Fetch 路由。
- 审批钩子不触发：`ctx.effect(() => ctx.on(...))` 包裹无效 → 直接 `ctx.on(...)`。
- 审批读取参数错误：使用 `exec.args` 导致 tool 为 undefined → 改读 `exec.arguments`。

### Known issues

- 审批 UI 矩阵（read-only / workspace-write / danger-full-access）在本次提交时等待重启后的真机验证。
- host 半仍保留 debug.log 诊断代码，发布前移除。
