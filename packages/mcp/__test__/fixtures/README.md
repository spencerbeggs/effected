# Fixtures

## `server.ts`

- **Producing tool:** none. Hand-authored against `effect@4.0.0-rc.117`'s
  `effect/unstable/ai` (`Tool`, `Toolkit`, `McpServer`) and this package's
  `McpStdio.layer` and `ToolFailure`.
- **Why hand-authored:** no real server produces every wire shape the
  harness, audit and toolkit tests need in one place. Each tool exists to
  produce exactly one of them:

| Tool | Wire shape it pins |
| --- | --- |
| `echo` | a success: `structuredContent` plus the same object as JSON text; also invalid params when `text` is not a string |
| `lookup` | a declared failure: `isError` text with the remediation folded into `message`, no `structuredContent` |
| `boom` | a handler defect: the scrubbed internal message on the wire, the cause logged on stderr |
| `ping` | a zero-parameter tool called with an empty `arguments` object |
| `hang` | a call that never completes, for the stdin-closes-mid-request path |
| `garble` | a stray non-JSON-RPC line on stdout, for `strictStdout` |
| `grow` | a runtime `addTool`, which makes the server send `notifications/tools/list_changed` |
| `version` | a bare-string (non-object) success output |

- **Compositions:** `fixtureServer` provides the toolkit WITH
  `McpStdio.layer` (the okfit shape); `fixtureServerMerged` merges it
  BESIDE the layer, so the toolkit never sees the layer's outputs at
  build time. Both must keep defect logs off `console.log`.
- **Regenerating:** there is nothing to regenerate. Edit by hand, and keep
  one wire shape per tool.
