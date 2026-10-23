# dsh-sidebar-browser-use

[English](README.md)

DeepSeek Harness 的 browser-use MCP：模型通过两个稳定工具驱动右侧栏内置浏览器，模型侧工具面恒定，不随浏览器能力增长，prompt cache 稳定。

## 暴露的工具

常见的浏览器 MCP 往往一次暴露 15-40 个工具。本插件只暴露：

- `browser_use_list`：返回内部工具目录（名称、读/写、参数、调用示例）。只读，不审批。
- `browser_use_call`：执行一个内部工具，参数 `{ tool, args, reason? }`。唯一执行入口，也是唯一审批点。

内部工具：`browser_tabs`、`browser_snapshot`、`browser_text`、`browser_screenshot`、`browser_navigate`、`browser_click`、`browser_fill`、`browser_press`、`browser_history`、`browser_open`，以及默认关闭的 `browser_eval`。

## 架构

```
模型
  -> mcp__browser-use__browser_use_list / browser_use_call
  -> mcp/server.js（stdio MCP server，@modelcontextprotocol/server）
       -> 本机 HTTP bridge（127.0.0.1，每次启动随机 token）
            -> host 半（lib/index.js）
                 -> tools/pre-execute 审批钩子（DSH 原生审批 + sandbox 模式）
                 -> Connection Fetch 路由 /api/browser-use
                      -> client 半（lib/client.js）
                           -> 右侧栏浏览器的可见 electron <webview>
```

host 半不注册任何模型工具。审批完全交给 DSH：非 danger-full-access 会话中的写操作，由 host 半在 `tools/pre-execute` 返回 `{ kind: 'ask' }`。

## 配置

在 profile 补丁层覆盖 host 行：

```yaml
- id: browser-use-mcp
  config:
    allowEvaluate: false      # 是否暴露 browser_eval（可执行任意页面 JS），默认关闭
    commandTimeoutMs: 30000   # 单条命令等待 client 的超时
```

## 已知限制

- 仅桌面版。Web profile 的侧栏浏览器是 iframe，没有 `executeJavaScript`。
- MCP server 是进程级，没有每会话隔离。
- bridge 命令不按窗口路由：同时打开多个 DSH 窗口时，命令可能被任一窗口的渲染层取走并在该窗口的侧栏浏览器执行；建议单窗口使用。
- 跨域 iframe 内容不可读；同源 iframe 内部也未递归遍历。
- 侧栏 webview 中页面内导航（链接点击、表单提交）不产生历史条目，`browser_history back` 会跳过这些页面，回到最近一次 `browser_navigate` 的页面。
- ref 只在最近一次 `browser_snapshot` 内有效。
- 截图超过 1600x1200 会等比缩放；base64 超过约 2M 字符时拒绝返回，并提示改用 browser_snapshot。

## 调试与排障

- 宿主侧诊断：插件写标准 DSH 日志（`browser-use-mcp`）；`$DSH_HOME/browser-use-mcp/bridge.json` 记录当前端口、pid 与启动时间，不再有独立日志文件。
- 修改 host/client 插件代码后必须**重启 DSH**：plugin_manager 的禁用/启用不会重新读取磁盘模块（ESM 缓存）。
- `BRIDGE_NOT_READY`：host 半未启动或 bridge.json 过期，重启 DSH。
- `CLIENT_OFFLINE`：当前窗口的渲染层未在轮询（窗口关闭或切换中），确认 DSH 窗口在前台后重试。
- `NO_BROWSER_TAB`：右侧栏没有可见浏览器页面，先在右侧栏打开浏览器或调用 browser_open。
- `NO_SUCH_REF`：ref 已过期，重新调用 browser_snapshot。

## License

MIT
