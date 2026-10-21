# AGENTS.md — dsh-browser-use-mcp

本文件面向接手本项目的 agent。请先读完再动手。

## 项目简介

一个 DeepSeek Harness（DSH）插件：把“模型操控右侧栏内置浏览器（Electron webview）”做成一个 stdio MCP server。模型侧只暴露两个稳定工具，工具面不随浏览器能力增长：

- `browser_use_list`：返回内部工具目录（只读，不审批）。
- `browser_use_call`：唯一执行入口与唯一审批点，参数 `{ tool, args, reason? }`。

内部工具：browser_tabs / browser_snapshot / browser_text / browser_screenshot / browser_navigate / browser_click / browser_fill / browser_press / browser_history / browser_open，以及默认关闭的 browser_eval。

环境：DSH Desktop 0.2.0-rc.2（Electron 44 / Chromium 152，host Node 24），MCP 服务端依赖 @modelcontextprotocol/server 2.3.1（对应 2026-07-28 协议），测试用 @modelcontextprotocol/client 2.0.0。

## 当前状态（2026-10-21 11:45）

- **浏览器功能真机测试通过**（2026-10-21，侧栏 webview + 本地测试页）：list / tabs / snapshot / text / screenshot（PNG 附件可见，708x1200）/ navigate / click / fill / 表单提交 / press / history（back、forward、reload）/ open 全部正常；`INVALID_ARGS`、`EVAL_DISABLED`、`NO_SUCH_REF`、`NO_BROWSER_TAB` 错误码与 hint 正确。
- **审批矩阵真机验证通过**（2026-10-21，重启加载新模块后）：
  - read-only / workspace-write：写工具弹 DSH 原生审批（日志 `tool=<name> mode=<mode> -> ask`）；拒绝 → 调用返回 `the user rejected tool` 且不执行；批准 → 执行成功。
  - danger-full-access：写工具直接执行（日志 `-> allow`），不弹卡。
  - 读工具在三种模式下均不审批（`tool=browser_tabs mode=... -> allow`）。
  - `browser_eval`（allowEvaluate=false）：审批门放行、dispatch 返回 `EVAL_DISABLED`，不弹无意义审批卡。
  - 嵌套调用（run_code/PTC 内绑定 `browser_use_call`）同样触发 pre-execute 并正常弹审批。
- 三项修复已生效并验证：
  - `exec.arguments` 修复：日志 `tool=` 全部正确，不再出现 `undefined`（旧版会把写操作放行，已消除）。
  - `browser_history` 等待修复：`navigate → back` 正确返回新 URL；栈底报“没有可后退的历史”。
  - 工作区 ACL 修复：workspace-write 下沙箱与文件工具正常（此前 `SetNamedSecurityInfoW Win32 5`）。
- 测试确认的行为特性：侧栏 webview 中**页面内导航（点击链接、表单提交）不产生历史条目**，`browser_history back` 会跳过该页、回到最近一次 `browser_navigate` 的页面（受控实验复现）。
- 本地质量门（2026-10-21）：`npm test` 18/18；`node --check` 通过；`npm pack --dry-run` 通过（12 文件 / 21 kB，双语 README 合并后）。
- 仓库：`main` 分支，本地 commit（2026-10-21 已提交 history 修复与文档更新），无远程；工作树状态以 `git status` 为准。诊断代码（`dbg(` / debug.log）仍在，发布前删除。

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
- bridge 不是独立 listener：host 用 `ctx.webServer.register({ kind: 'prefix', path: '/browser-use-bridge' })` 把它挂在 DSH webServer 上，端口取 `ctx.webServer.port`；所谓“仅 127.0.0.1”取决于 DSH webServer 的监听配置，不是插件自身保证。
- renderer 半 `lib/client.js` 是 DSH 客户端模块（`window.__ModuleLoader__.load({ id, factory })` 包装，`exports.inject = ['connection']`）；poll 周期 200ms（页面隐藏时 1000ms），失败按 500/1k/2k/5k ms 退避。

## 文件地图

- `mcp/server.js`：MCP 入口（serveStdio + 两个工具注册，模型侧 schema/描述）。
- `mcp/catalog.js`：内部工具目录、读/写集合、参数校验、URL 校验（新增工具第一步）。
- `mcp/dispatch.js`：工具名 trim、eval 门控、参数校验、转发 bridge。
- `mcp/bridge-client.js`：读 bridge.json、HTTP 请求、错误映射（BridgeCallError）。
- `mcp/errors.js`：错误码与 MCP 错误内容投影（保留 hint）。
- `lib/index.js`：host 半——bridge 路由、renderer fetch 路由、审批钩子、inflight/超时/清理。
- `lib/approval.js`：纯函数审批决策（规则顺序、目标摘要、中英文审批文案；详见“审批实现原理”）。
- `lib/client.js`：renderer 半——轮询、webview 定位、页面脚本注入（snapshot/click/fill/press）、导航/截图/tabs。
- `cordis.patch.yml`：bundle patch（host 行 + `@deepseek-ai/dsh-mcp-client` 行，MCP server 路径按 profile 拼接）。
- `package.json`：安装契约——`dsh.bundle.patch`、`dsh.client.inject`（connection + ui-sidebar-right）、`dsh.engines.dsh`、`files` 白名单。
- `scripts/install-dev.ps1` / `uninstall-dev.ps1`：link 安装与回滚（备份 profile 的 package.json/pnpm-lock/cordis.patch.yml）。
- `test/*.test.mjs`：18 项（approval 6、catalog 5、errors 3、host 3、server 1）；`test/server-smoke.mjs` 是手动冒烟脚本（待删）。
- `README.md`（中英双语精简版）/ `CHANGELOG.md` / `LICENSE`：使用者文档与版本历史，状态变化需同步（见“文档与状态同步”）。
- `.gitattributes`：md/js/mjs/yml 强制 LF、ps1 强制 CRLF；`.gitignore` 忽略 node_modules、日志、临时文件、密钥类文件（.env/*.pem/*.key/bridge.json）、构建产物与环境产物。

## 开发命令

```powershell
cd <repo-root>                    # 仓库根目录（本机为项目所在目录）
npm install
npm test                          # 等价 node --test "test/**/*.test.mjs"，当前 18 项全过
node --check lib/index.js         # 逐文件：lib/*.js、mcp/*.js 共 8 个
npm pack --dry-run                # 发布预检：12 个文件 / ~21 kB
```

- `lib/client.js` 是 renderer bundle，不能当普通 ESM import 做单测，也没有自动化覆盖；改它只能真机验证。
- 修改 host/client 插件代码后：**必须重启 DSH 主进程**。已实测 plugin_manager 的禁用/启用会触发 apply，但不会重新读取磁盘模块（Node ESM 模块缓存），旧行为保持不变。

## 关键设计约束

1. host 插件零 `@deepseek-ai/*` import（沿用本地其他插件的做法），避免 link 安装下的模块解析问题。
2. **不要用 `ctx.connection.rpc.handle()` 注册通道**：它通过 Connection 服务上下文注册 webServer 路由，该上下文没有 webServer inject，会抛 `cannot get property "webServer" without inject`，插件 fiber 变 failed、bridge 路由不注册（POST 返回 405）。用 `ctx.connection.fetch.register({ path: '/api/browser-use', methods: ['POST'], requestBody: 'buffered', fetch })`。
3. renderer 侧用同源 `fetch('/api/browser-use')`，经 `dsh-app://app` 由 Electron 主进程转发并注入认证 cookie（这正是 DSH 前端访问 /api 的链路）。
4. 审批钩子直接 `ctx.on('tools/pre-execute', async (exec, next) => ...)`；参数读 `exec.arguments`（工具参数对象），不要读 `exec.args`；返回 `{ kind: 'ask', ... }` 弹卡、`undefined`/`next()` 放行，拒绝时 DSH 直接失败该调用（不会到达 MCP server）。
5. `browser_use_call` 的 `tool` 名在审批门与 dispatch 两侧都要 trim（已修，防止带空白绕过）。
6. client 每次 snapshot 重建 ref 映射（`window.__dshBrowserUseRefs`）；ref 只在最近一次 snapshot 内有效。
7. 截图 MCP image content 在原生工具调用下可渲染；在 PTC/run_code 中调用 MCP 工具时参数不能含 undefined 属性（`args: undefined` 会报 `binding arguments must be lossless JSON`）。
8. bridge 复用 DSH webServer 端口（`ctx.webServer.port`），host 用 `ctx.webServer.register({ kind: 'prefix', path: '/browser-use-bridge' })` 注册；MCP server 用 `127.0.0.1:<port>` 直连。不要把“仅本机监听”当成插件自身保证。
9. bridge.json 每次 apply（含热重载）重写，token/startedAt 随之变化；MCP server 每次调用重读描述文件，所以能跟上 host 重启；MCP server 进程本身由 DSH 启动时 spawn，常驻。
10. 新增内部工具要同时改三处：`mcp/catalog.js` 的 `INTERNAL_TOOLS`（`kind` 决定是否审批）、`lib/client.js` 的 `executeCommand` switch（决定执行）、必要时 `mcp/errors.js` 错误码；`catalog.test.mjs` 的同步检查会兜底。
11. 审批只覆盖 `mcp__browser-use__browser_use_call`；`browser_eval` 在 `allowEvaluate=false` 时审批门直接放行（不弹卡），真正的拦截是 `mcp/dispatch.js` 的 `EVAL_DISABLED`；bridge 路由本身不做 eval 门控（持有 token 的本机调用方可越过），属 defense-in-depth 缺口。
12. 错误一律带稳定 code（`mcp/errors.js`）与中文 hint；模型侧依赖 code 决定下一步。

## 审批实现原理

### 设计目标

审批点唯一、模型工具面恒定：模型只能通过 `browser_use_call` 执行浏览器操作，因此审批只需挂在这一个工具上；`browser_use_list` 是纯读目录，永不审批。审批不重复实现 UI，而是复用 DSH 原生权限体系（`tools/pre-execute` 钩子 + 会话 sandbox mode）。

### 分层：两道独立防线

1. **审批门（host 半，`lib/index.js`）**：回答“是否允许执行”，决定弹卡 / 放行。
2. **能力门控（MCP server 半，`mcp/dispatch.js`）**：回答“该能力是否启用”（目前只有 `browser_eval` 的 `allowEvaluate`），先于任何 bridge 请求发生。

两者互不替代：审批门放行不等于能力可用；能力开启后写操作仍要走审批。

### 审批门（host 半）

```js
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name !== 'mcp__browser-use__browser_use_call') return next(); // 唯一执行入口才处理
  const payload = exec.arguments ?? {};                                  // 参数在 arguments，不是 args
  const mode = ctx.get('sandboxPolicy')?.resolve({ session: exec.agent?.session }).mode;
  const decision = decideApproval({ tool: payload.tool, args: payload.args, purpose: payload.reason, allowEvaluate, mode });
  return decision ?? next();
});
```

关键点：

- 监听器必须**直接** `ctx.on('tools/pre-execute', ...)`；用 `ctx.effect(() => ctx.on(...))` 包裹时监听器不生效（已修复）。
- 工具参数在 **`exec.arguments`**（工具参数对象）。旧实现读 `exec.args` 导致 `tool=undefined`，审批判定全部落入“非写工具”分支——这是曾出现的真实放行漏洞，已修复并验证。
- 会话权限模式从 `ctx.get('sandboxPolicy')?.resolve({ session: exec.agent?.session }).mode` 读取；取不到或抛错记作 `unknown`，继续走 ask 分支（fail closed 由 dsh-tools 保证）。
- 返回 `{ kind: 'ask', reason, displayReason: { en, zh } }` 由 DSH 弹原生审批卡；返回 `undefined`（`next()`）表示放行。
- 拒绝时 DSH 直接让该次工具调用失败（模型侧收到 `the user rejected tool "..."`），调用根本不会进入 MCP server → dispatch → bridge，浏览器侧无任何动作。
- 只匹配 `mcp__browser-use__browser_use_call` 一个工具名，其他工具的 pre-execute 直接 `next()`，零影响。

### 决策函数（`lib/approval.js`，纯函数）

`decideApproval({ tool, args, purpose, allowEvaluate, mode })` 规则（顺序即优先级）：

1. `tool` 先 `trim()`；未知/非写工具 → 放行（防“带空白绕过”）。读/写集合由 `mcp/catalog.js` 的 `INTERNAL_TOOLS[].kind` 派生（`READ_TOOLS`/`WRITE_TOOLS`），新增工具必须标对 `kind`。
2. `browser_eval` 且 `allowEvaluate !== true` → 放行（不弹无意义卡片；真正拦截在 dispatch 的 `EVAL_DISABLED`）。
3. `mode === 'danger-full-access'` → 放行。
4. 其他（`read-only` / `workspace-write` / 取不到 / 未知）→ `ask`。

审批卡文案：`reason` 形如 `browser_use_call → browser_navigate (https://example.com)：<reason>`；`displayReason` 提供中英文文案；目标摘要（`summarizeTarget`）取 `url` / `ref=` / `direction` / `key=` / `script` 前 80 字符。

### 为什么读工具不审批、写工具审批

- 读工具（tabs/snapshot/text/screenshot）不改变页面状态，频繁弹卡会破坏使用体验。
- 写工具（navigate/click/fill/press/history/open/eval）会改变页面状态或触发外部副作用，需要用户确认目标与意图（审批卡展示 URL/ref/按键等摘要）。
- `danger-full-access` 是用户显式选择的完全权限模式，此时不再逐次打断；`read-only` 与 `workspace-write` 都要求“写操作必须确认”。

### 已验证矩阵（2026-10-21 真机）

| 会话模式 | 读工具 | 写工具 | 拒绝 | 批准 |
|---|---|---|---|---|
| danger-full-access | allow，不弹 | allow，不弹 | — | 直接执行 |
| workspace-write | allow，不弹 | ask，弹卡 | 返回 `the user rejected tool`，不执行 | 执行成功 |
| read-only | allow，不弹 | ask，弹卡 | 返回 `the user rejected tool`，不执行 | 执行成功 |

日志实录：`approval decision: tool=browser_open mode=workspace-write -> ask`、`tool=browser_tabs mode=workspace-write -> allow`、`tool=browser_navigate mode=read-only -> ask`。

### 与权限体系的关系与缺口

- 审批只决定“是否执行”，不改变文件沙箱；浏览器工具不是安全边界，真正边界是会话权限预设 + DSH 审批。
- fail closed：审批不可用/模式未知时按 ask 处理，由 dsh-tools 兜底。
- 已知缺口：`browser_eval` 在 `allowEvaluate=false` 时审批门放行、由 dispatch 拦截；bridge 路由本身无 eval 门控，持有 bridge token 的本机调用方可越过（风险可控：127.0.0.1 + 随机 token，MCP server 是唯一常规调用者）。可选增强：bridge/client 侧也加 allowEvaluate 门控。

## 安装与回滚

```powershell
pwsh -File scripts/install-dev.ps1
# 重启 DSH 主进程
pwsh -File scripts/uninstall-dev.ps1 -BackupDir <备份目录>
```

- 备份位于 `$DSH_HOME/.backups/browser-use-mcp-<timestamp>`；安装会改 profile 的 package.json（link 依赖）与 `dsh.profile.bundles`，并在 profile 目录跑 DSH 自带 pnpm install。
- 桌面版 DSH 安装目录由脚本从运行进程推断（Windows 默认安装在 Program Files 下的 dsh 目录）；推断失败时传 `-DshInstallDir`。
- 当前 desktop profile 已是 link 安装（Junction 指向项目），重装前先跑备份。

## 回归验证清单（2026-10-21 已全部通过）

以下清单已按顺序真机验证通过，后续改动可复用：

0. 确认已加载新模块：`$DSH_HOME/browser-use-mcp/debug.log` 出现新的 `apply start … apply complete`，且 pre-execute 行带 `arguments={...}`（旧版无此后缀）。
1. danger-full-access：写操作直接执行；日志 `mode=danger-full-access -> allow`。
2. workspace-write：写操作弹审批；日志 `mode=workspace-write -> ask` 且 `tool=browser_navigate`。拒绝 → 返回拒绝错误、不执行；批准 → 执行。
3. read-only：写操作弹审批（`mode=read-only -> ask`）；拒绝 → 不执行。
4. 读工具三种模式均可用且不审批。
5. `browser_eval`：`allowEvaluate=false` 时目录中不出现，调用返回 `EVAL_DISABLED`。
6. `browser_history`：navigate A → navigate B → back 返回 A；栈底报“没有可后退的历史”。

## 文档与状态同步

- 交接权威源是本文件（状态、验证清单、审批原理、待办）；README.md（中英双语）面向使用者，CHANGELOG 记录版本历史。
- 2026-10-21：审批矩阵已真机验证通过，文档已同步；README.md 已重写为精简双语版（原 README.zh.md 内容已并入，文件移至 .trash 备份）。
- 每次状态变化（删除 dbg、发布）必须同步：本文件、README.md、CHANGELOG.md。

## 待办

### 发布阻断项

1. 移除 host 半诊断代码：搜索 `dbg(`（`lib/index.js`），删除 debug.log 写入；发布前确认 `$DSH_HOME/browser-use-mcp/debug.log` 不再增长。
2. 删除或归档 `test/server-smoke.mjs`（已被 `test/server.test.mjs` 覆盖）。
3. 文档收尾：发布前复核 README.md（中英双语）/CHANGELOG.md 与实现一致（本次已更新）。

### 发布准备

4. `npm pack` 预检已通过（12 文件 / 21 kB）；仍需 README 截图/演示、GitHub 仓库、package.json 的 repository/homepage 元数据。
5. `~/.dsh/repo-structure.md` 清单登记（[dev-local]）——已确认当前**未登记**。
6. 评估是否公开 `browser_eval`（默认关闭）及包元数据（repository/homepage/keywords）。

### 功能增强（按价值排序）

7. `browser_open` 后等待新页面出现（轮询 tabs 的 lease），而不是让模型自己再查一次。
8. 多窗口命令路由：pending 命令绑定 clientId/session，poll 只取本窗口命令，result 校验归属（当前任一 renderer 可领取/回传）。
9. 等待原语 `browser_wait`（等待 selector/文本/导航完成），降低动态页面下 ref 失效导致的失败率。
10. 观测能力：console 日志、网络请求摘要、同源 iframe 遍历。
11. `browser_fill`/`browser_press` 目前用合成 DOM 事件，需真机验证 React/Vue 受控组件；必要时改用更接近真实输入的方式。
12. 截图落盘（写临时文件供 `read_image` 使用），解决 PTC/run_code 下 image content 不可见的场景。
13. 安全增强：bridge/client 侧也对 `browser_eval` 做 allowEvaluate 门控；pending 队列加上限。

## 已知限制

- 仅桌面版（Web profile 的侧栏浏览器是 iframe，无 executeJavaScript）；`browser_open` 依赖 `sidebarRight.openTab`，Web profile 不可用。
- MCP server 进程级共享，无每会话工具隔离；bridge 命令不按窗口路由，多窗口时可能被任一渲染层取走，建议单窗口使用；result 回传也不校验领取者。
- 跨域 iframe 内容不可读；同源 iframe 内部也未递归遍历（page script 只在主文档查询）；ref 生命周期到下一次 snapshot。
- 动态页面无等待/重试原语，ref 失效快，失败时需重新 snapshot。
- 侧栏 webview 中页面内导航（链接点击、表单提交）不产生历史条目，`browser_history` 无法回退到这些页面（只能回到最近一次 `browser_navigate` 的页面）。
- 无 console/network 观测；`browser_fill`/`browser_press` 用合成 KeyboardEvent/DOM 事件，部分受控组件可能不响应。
- 截图会进入会话附件记录；超过 1600x1200 会等比缩放，base64 超 ~2M 字符拒绝返回。
- Windows 上 bridge.json 的 0600 语义不生效，依赖用户目录 ACL。

## 安全注意

- bridge 复用 DSH webServer 端口，监听范围由 DSH 决定（不要假设仅 127.0.0.1）；另加随机 Bearer token。
- bridge token 写在 `$DSH_HOME/browser-use-mcp/bridge.json`；日志、回复、提交中不得出现 token 值。
- URL 仅 http/https，拒绝内嵌凭据、file:、javascript:（catalog/dispatch 与 client 双处校验）。
- 日志不记录页面正文/表单值/截图内容；debug.log 只记录阶段名与工具名/参数摘要，但会记录所有工具名（含非本插件工具），发布前移除。
- 新增工具时务必确认 `kind` 正确，否则审批门会漏放。
- 浏览器工具不是安全边界，安全依赖会话权限预设 + DSH 审批。
