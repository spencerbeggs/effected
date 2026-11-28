---
"@effected/mcp-kit": patch
---

## Documentation

* `McpToolkit.unionTool` and the `McpToolkit.layer` registration now describe how Effect 4.1.7 answers a handler's own `McpSchema.InvalidParams`: as invalid input, JSON-RPC `-32602` on `2025-06-18` and an `isError` result on later revisions, not as a declared failure.
