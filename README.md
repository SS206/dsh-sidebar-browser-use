# dsh-browser-use-mcp

DeepSeek Harness 插件：通过两个稳定工具（`browser_use_list` + `browser_use_call`）驱动右侧栏内置浏览器，模型侧工具面恒定。
A DeepSeek Harness plugin that drives the built-in right-sidebar browser through two stable tools (`browser_use_list` + `browser_use_call`), keeping the model-facing tool surface constant.

## 状态 / Status

开发中（0.1.0，**尚未发布到 npm**）。浏览器功能与审批矩阵已于 2026-10-21 真机验证通过。
Under development (0.1.0, **not published to npm yet**). Browser features and the approval matrix were verified end to end on 2026-10-21.

## 安装 / Install

> 0.1.0 尚未发布到 npm：请从源码本地安装；发布后可改用 `dsh plugin --profile desktop add dsh-browser-use-mcp`。
> 0.1.0 is not on npm yet: install from source for now; once published, `dsh plugin --profile desktop add dsh-browser-use-mcp` will work.

```powershell
git clone <repo-url>
cd dsh-browser-use-mcp
npm install
pwsh -File scripts/install-dev.ps1    # link into the desktop profile
# restart DSH
```

要求：DSH Desktop ≥ 0.2.0-rc.2（侧栏浏览器为 Electron webview；Web/headless profile 不支持）。
Requirements: DSH Desktop >= 0.2.0-rc.2 (desktop only; the web/headless profile has no webview).

卸载 / Uninstall: `pwsh -File scripts/uninstall-dev.ps1`

## 使用 / Usage

- `browser_use_list`：返回内部工具目录，不审批。
  Returns the internal tool catalog; never asks for approval.
- `browser_use_call({ tool, args, reason? })`：唯一执行入口。内部工具：tabs / snapshot / text / screenshot / navigate / click / fill / press / history / open；`browser_eval` 默认关闭。
  The only execution entry. Internal tools: tabs / snapshot / text / screenshot / navigate / click / fill / press / history / open; `browser_eval` is disabled by default.

## 审批 / Approval

- 读工具不弹审批；写工具在 `read-only` / `workspace-write` 会话中弹 DSH 原生审批（拒绝则不执行），`danger-full-access` 直接放行。
  Read tools never prompt; write tools prompt in `read-only` / `workspace-write` sessions (reject = not executed), and never prompt in `danger-full-access`.
- 审批实现原理见 [AGENTS.md](AGENTS.md)。
  Implementation notes: [AGENTS.md](AGENTS.md).

## 配置 / Configuration

profile 中的 host 行（通常无需修改）。Host row in the profile (usually not needed):

```yaml
- id: browser-use-mcp
  config:
    allowEvaluate: false      # 启用 browser_eval（任意页面 JS）/ expose browser_eval
    commandTimeoutMs: 30000   # 单条命令超时 / per-command deadline
```

## 安全与限制 / Security & Limits

- 仅桌面版；bridge 仅本机（DSH webServer 端口 + 每次启动随机 token）。
  Desktop only; the bridge stays local (DSH webServer port + per-boot random token).
- 浏览器工具不是安全边界，依赖会话权限预设 + DSH 审批。
  Browser tools are not a security boundary; rely on the session permission preset and DSH approval.
- 已知限制：页面内导航不产生历史条目；多窗口命令不按窗口路由；跨域与同源 iframe 均未遍历；ref 仅到下一次 snapshot。
  In-page navigation does not create history entries; commands are not routed per window; iframe subtrees are not traversed; a ref is valid only until the next snapshot.

## 开发 / Development

```bash
npm test
node --check lib/index.js
```

设计、踩坑与验证记录见 [AGENTS.md](AGENTS.md)；版本历史见 [CHANGELOG.md](CHANGELOG.md)。
Design notes and verification records: [AGENTS.md](AGENTS.md); history: [CHANGELOG.md](CHANGELOG.md).

## License

MIT
