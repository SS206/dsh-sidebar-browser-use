# dsh-sidebar-browser-use

[中文版](README.zh.md)

Browser-use MCP for DeepSeek Harness. The model drives the built-in right-sidebar browser through exactly two stable tools, so the model-facing tool surface never grows and prompt caching stays stable.

## Exposed Tools

Most browser MCPs expose 15-40 tools at once. This one exposes:

- `browser_use_list` - returns the internal tool catalog (names, kinds, parameters, examples). Read-only, no approval.
- `browser_use_call` - executes one internal tool: `{ tool, args, reason? }`. The only execution entry and the only approval point.

Internal tools: `browser_tabs`, `browser_snapshot`, `browser_text`, `browser_screenshot`, `browser_navigate`, `browser_click`, `browser_fill`, `browser_press`, `browser_history`, `browser_open`, and `browser_eval` (disabled by default).

## Architecture

```
model
  -> mcp__browser-use__browser_use_list / browser_use_call
  -> mcp/server.js (stdio MCP server, @modelcontextprotocol/server)
       -> loopback HTTP bridge (127.0.0.1, per-boot token)
            -> host half (lib/index.js)
                 -> tools/pre-execute approval gate (DSH approval + sandbox mode)
                 -> Connection Fetch route /api/browser-use
                      -> renderer half (lib/client.js)
                           -> visible electron <webview> of the sidebar browser
```

The host half registers no model-facing tools. Approval is delegated to DSH: the host half returns `{ kind: 'ask' }` from `tools/pre-execute` for write tools outside danger-full-access sessions.

## Configuration

Patch the host row in the profile (or a bundle layer):

```yaml
- id: browser-use-mcp
  config:
    allowEvaluate: false      # expose browser_eval (arbitrary page JS); default false
    commandTimeoutMs: 30000   # per-command deadline towards the renderer
```

## Known limitations

- Desktop only. The web profile renders the sidebar browser in an iframe, which has no `executeJavaScript`.
- The MCP server is process-wide; it has no per-session isolation.
- Bridge commands are not routed per window: with several DSH windows open, any renderer may claim a command and run it against its own sidebar browser. Single-window use is recommended.
- Cross-origin iframes are not readable from the page script; same-origin iframe subtrees are not traversed either.
- In-page navigation (link clicks, form submits) does not create history entries in the sidebar webview; `browser_history back` skips those pages and returns to the most recent `browser_navigate` page.
- A ref is valid only until the next `browser_snapshot`.
- Screenshots are downscaled to 1600x1200; a base64 image over ~2M characters is refused with a hint to use browser_snapshot.

## Troubleshooting

- Host diagnostics: the plugin logs through the standard DSH logger (`browser-use-mcp`); `$DSH_HOME/browser-use-mcp/bridge.json` reports the live port, pid and start time. There is no separate log file any more.
- Restart DSH after changing host/client code: plugin_manager enable/disable does not re-read modules from disk (ESM cache).
- `BRIDGE_NOT_READY`: host half not started or stale bridge.json; restart DSH.
- `CLIENT_OFFLINE`: the renderer in the current window is not polling (closed or switching); keep the DSH window in front and retry.
- `NO_BROWSER_TAB`: no visible sidebar browser page; open one in the right sidebar or call browser_open.
- `NO_SUCH_REF`: the ref is stale; call browser_snapshot again.

## License

MIT
