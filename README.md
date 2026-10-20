# dsh-browser-use-mcp

Browser-use MCP for DeepSeek Harness. The model drives the built-in right-sidebar browser through exactly two stable tools, so the model-facing tool surface never grows and prompt caching stays stable.

## Status

Under development (0.1.0, unpublished). The end-to-end path is verified: list, tabs, snapshot, text, screenshot, navigate, click, fill+submit, history and open all work. Regression coverage for the approval matrix (read-only / workspace-write / danger-full-access) is still in progress; the host-side diagnostic log (`$DSH_HOME/browser-use-mcp/debug.log`) stays until release.

## Why two tools

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

## Install

```bash
dsh plugin --profile desktop add dsh-browser-use-mcp
```

For a local checkout:

```powershell
pwsh -File scripts/install-dev.ps1
# restart DSH afterwards
```

The install script backs up the profile files to `$DSH_HOME/.backups/browser-use-mcp-<timestamp>`; roll back with `scripts/uninstall-dev.ps1`.

## Configuration

Patch the host row in the profile (or a bundle layer):

```yaml
- id: browser-use-mcp
  config:
    allowEvaluate: false      # expose browser_eval (arbitrary page JS); default false
    commandTimeoutMs: 30000   # per-command deadline towards the renderer
```

## Approval

- Read tools never ask.
- Write tools ask the user outside `danger-full-access` sessions.
- `danger-full-access` skips the prompt; the tool descriptions remind the model to confirm intent and target.
- Rejecting or cancelling the approval fails the call without executing it.

## Security notes

- The bridge listens on 127.0.0.1 only, with a random per-boot bearer token stored in `$DSH_HOME/browser-use-mcp/bridge.json` (created with mode 0600 on POSIX; on Windows it relies on the user-directory ACL).
- URLs are restricted to http/https without embedded credentials; `file:` and `javascript:` are rejected.
- Snapshots and text are truncated; screenshots are downscaled before encoding.
- Like every browser tool, this is not a security boundary: run it in a session whose permission preset you trust.

## Known limitations

- Desktop only. The web profile renders the sidebar browser in an iframe, which has no `executeJavaScript`.
- The MCP server is process-wide; it has no per-session isolation.
- Bridge commands are not routed per window: with several DSH windows open, any renderer may claim a command and run it against its own sidebar browser. Single-window use is recommended.
- Cross-origin iframes are not readable from the page script.
- A ref is valid only until the next `browser_snapshot`.
- Screenshots are downscaled to 1600x1200; a base64 image over ~2M characters is refused with a hint to use browser_snapshot.

## Troubleshooting

- Host diagnostics: `$DSH_HOME/browser-use-mcp/debug.log` records apply stages plus every `tools/pre-execute` tool name, argument summary and approval decision.
- Restart DSH after changing host/client code: plugin_manager enable/disable does not re-read modules from disk (ESM cache).
- `BRIDGE_NOT_READY`: host half not started or stale bridge.json; restart DSH.
- `CLIENT_OFFLINE`: the renderer in the current window is not polling (closed or switching); keep the DSH window in front and retry.
- `NO_BROWSER_TAB`: no visible sidebar browser page; open one in the right sidebar or call browser_open.
- `NO_SUCH_REF`: the ref is stale; call browser_snapshot again.

## Development

```bash
npm install
node --test "test/**/*.test.mjs"
node --check lib/index.js
```

See [AGENTS.md](AGENTS.md) for design notes, conventions and pitfalls; see [CHANGELOG.md](CHANGELOG.md) for history.

## License

MIT
