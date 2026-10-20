# AGENTS.md — dsh-browser-use-mcp

本文件面向接手本项目的 agent。请先读完再动手。

## 项目简介

一个 DeepSeek Harness（DSH）插件：把“模型操控右侧栏内置浏览器（Electron webview）”做成一个 stdio MCP server。模型侧只暴露两个稳定工具，工具面不随浏览器能力增长：

- `browser_use_list`：返回内部工具目录（只读，不审批）。
- `browser_use_call`：唯一执行入口与唯一审批点，参数 `{ tool, args, reason? }`。

内部工具：browser_tabs / browser_snapshot / browser_text / browser_screenshot / browser_navigate / browser_click / browser_fill / browser_press / browser_history / browser_open，以及默认关闭的 browser_eval。

环境：DSH Desktop 0.2.0-rc.2（Electron 44 / Chromium 152，host Node 24），MCP 服务端依赖 @modelcontextprotocol/server 2.3.1（对应 2026-07-28 协议），测试用 @modelcontextprotocol/client 2.0.0。

## 当前状态（2026-10-20）

- 端到端功能已验证通过：list、tabs、snapshot、text、screenshot（PNG 图片附件可见）、navigate、click、fill+submit、history back、open，错误码与 hint 正常。
- **审批 UI 矩阵尚未完成真机验证**。两处根因已修复，等待重启后验证：
  1. pre-execute 监听器必须直接 `ctx.on('tools/pre-execute', ...)`；用 `ctx.effect(() => ctx.on(...))` 包裹时监听器不生效。
  2. 工具参数在 **`exec.arguments`**（不是 `exec.args`）。
- 诊断代码仍在：host 半在 apply 各阶段与每次 pre-execute 时写 `$DSH_HOME/browser-use-mcp/debug.log`。发布前删除 dbg（搜 `dbg(`）。
- 插件已安装到 desktop profile（link 依赖 + bundle 追加），回滚用 `scripts/uninstall-dev.ps1`。

## 架构与数据流

```
模型
  -> mcp__browser-use__browser_use_list / browser_use_call
  -> mcp/server.js（stdio MCP server）
       -> 本机 HTTP bridge（127.0.0.1，Bearer token，描述文件 $DSH_HOME/browser-use-mcp/bridge.json）
            -> host 半 lib/index.js
                 -> ctx.connection.fetch.register({ path: '/api/browser-use' }) 渲染层通道
                 -> tools/pre-execute 审批钩子
                      -> client 半 lib/client.js（轮询 /api/browser-use）
                           -> 可见 webview[data-sidebar-browser-frame="webview"]
```

- MCP server 通过 bridge 发 `{ op: 'call', tool, args }`；host 生成 Command 放进内存队列，renderer client 轮询取走执行，结果回传。
- host 半不注册任何模型工具。
- bridge token 每次 host 启动随机生成；MCP server 每次调用重新读描述文件。

## 文件地图

- `mcp/server.js`：MCP 入口（serveStdio + 两个工具注册）。
- `mcp/catalog.js`：内部工具目录、读/写集合、参数校验、URL 校验。
- `mcp/dispatch.js`：工具名 trim、eval 门控、参数校验、转发 bridge。
- `mcp/bridge-client.js`：读 bridge.json、HTTP 请求、错误映射。
- `mcp/errors.js`：错误码与 MCP 错误内容投影（保留 hint）。
- `lib/index.js`：host 半——bridge 路由、renderer 通道、审批钩子、清理。
- `lib/approval.js`：纯函数审批决策（read-only/workspace-write → ask，danger-full-access → allow）。
- `lib/client.js`：renderer 半——轮询、webview 定位、页面脚本注入、导航/截图。
- `cordis.patch.yml`：bundle patch（host 行 + @deepseek-ai/dsh-mcp-client 行）。
- `scripts/install-dev.ps1` / `uninstall-dev.ps1`：link 安装与回滚。
- `test/*.test.mjs`：catalog/approval/errors/host/server 测试；`test/server-smoke.mjs` 是手动冒烟脚本。

## 开发命令

```powershell
cd D:\ProgramSource\Apps-Agent\DSH\dsh-browser-use-mcp
npm install
node --test "test/**/*.test.mjs"   # 18 项测试
node --check lib/index.js
```

修改 host/client 插件代码后：**必须重启 DSH**。经验证，plugin_manager 的禁用/启用不会重新读取磁盘模块（Node ESM 模块缓存），热重载无效。

## 关键设计约束

1. host 插件零 `@deepseek-ai/*` import（沿用本地其他插件的做法），避免 link 安装下的模块解析问题。
2. **不要用 `ctx.connection.rpc.handle()` 注册通道**：它通过 Connection 服务上下文注册 webServer 路由，该上下文没有 webServer inject，会抛 `cannot get property "webServer" without inject`，插件 fiber 变 failed、bridge 路由不注册（POST 返回 405）。用 `ctx.connection.fetch.register({ path: '/api/browser-use', methods: ['POST'], requestBody: 'buffered', fetch })`。
3. renderer 侧用同源 `fetch('/api/browser-use')`，经 `dsh-app://app` 由 Electron 主进程转发并注入认证 cookie（这正是 DSH 前端访问 /api 的链路）。
4. 审批钩子直接 `ctx.on('tools/pre-execute', async (exec, next) => ...)`；参数读 `exec.arguments`（工具参数对象），不要读 `exec.args`。
5. `browser_use_call` 的 `tool` 名在审批门与 dispatch 两侧都要 trim（已修，防止带空白绕过）。
6. client 每次 snapshot 重建 ref 映射（`window.__dshBrowserUseRefs`）；ref 只在最近一次 snapshot 内有效。
7. 截图 MCP image content 在原生工具调用下可渲染；在 PTC/run_code 中调用 MCP 工具时参数不能含 undefined 属性（`args: undefined` 会报 `binding arguments must be lossless JSON`）。

## 审批策略（产品要求）

- 读工具（tabs/snapshot/text/screenshot）不审批。
- 写工具（navigate/click/fill/press/history/open/eval）：
  - 会话 sandbox mode 为 `read-only` 或 `workspace-write` → 返回 `{ kind: 'ask', reason, displayReason }`，弹 DSH 原生审批。
  - `danger-full-access` → 放行，不弹审批。
  - 取不到 mode / 审批不可用 → 按 ask 处理（fail closed 由 dsh-tools 保证）。
- 审批钩子只匹配 `mcp__browser-use__browser_use_call`。

## 安装与回滚

```powershell
pwsh -File scripts/install-dev.ps1
# 重启 DSH
pwsh -File scripts/uninstall-dev.ps1 -BackupDir <备份目录>
```

备份位于 `$DSH_HOME/.backups/browser-use-mcp-<timestamp>`。安装会改 profile 的 package.json（link 依赖）与 dsh.profile.bundles。

## 重启后的验证清单（优先完成）

1. 读 `~/.dsh/browser-use-mcp/debug.log`：应有新的 `apply start … apply complete`。
2. 保持 danger-full-access，发起一次写操作（如 browser_navigate）：应直接执行；日志应有 `arguments={"tool":"browser_navigate",…}` 与 `mode=danger-full-access -> allow`。
3. 切到 workspace-write，发起写操作：应弹审批；日志 `mode=workspace-write -> ask`。请用户先拒绝一次（应返回拒绝错误、不执行），再批准一次（应执行）。
4. 切到 read-only，重复第 3 步（日志 `mode=read-only -> ask`）。
5. 读工具在任何模式下都应可用且不审批。

## 待办

1. 完成上面的审批矩阵真机验证；如日志显示 `tool=undefined`，检查 `exec.arguments` 是否被正确读取（不要退回 `exec.args`）。
2. 发布前移除 host 半的诊断代码（dbg / debug.log），或降级为 debug 级日志。
3. 删除或归档 `test/server-smoke.mjs`（已被正式测试覆盖）。
4. 可选增强：browser_open 等待新页面出现、多窗口命令路由（按 clientId/session 绑定）、browser_eval 的 allowEvaluate 验证、截图写入文件供 read_image 使用。
5. 开源发布准备：npm pack 预检、README 截图/演示、GitHub 仓库、`~/.dsh/repo-structure.md` 清单登记（[dev-local]）。

## 已知限制

- 仅桌面版（Web profile 的侧栏浏览器是 iframe，无 executeJavaScript）。
- MCP server 进程级共享，无每会话工具隔离；bridge 命令不按窗口路由，多窗口时可能被任一渲染层取走，建议单窗口使用。
- 跨域 iframe 内容不可读；ref 生命周期到下一次 snapshot；截图会进入会话附件记录。
- Windows 上 bridge.json 的 0600 语义不生效，依赖用户目录 ACL。

## 安全注意

- bridge 仅监听 127.0.0.1 + 随机 Bearer token；不要把它暴露到 LAN。
- URL 仅 http/https，拒绝内嵌凭据、file:、javascript:。
- 日志不记录页面正文/表单值/截图内容；debug.log 只记录阶段名与工具名/参数摘要（发布前移除）。
- 浏览器工具不是安全边界，安全依赖会话权限预设 + DSH 审批。
