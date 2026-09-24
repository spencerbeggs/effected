---
"@effected/mcp": patch
---

## Documentation

- `McpHarness` and `McpTestFailure` no longer claim a stateful revision always refuses a request sent before `initialize` with `Invalid request metadata`. That `-32602` comes from a stateless adapter listed first, as in `McpStdio.protocols`; a server that serves only stateful revisions answers `-32603 Internal error`.
- The README no longer says core's wedged stdio server exits 0 at stdin EOF. It ends with the status a healthy session ends with, which is 0 only under `McpStdio.teardown`.
