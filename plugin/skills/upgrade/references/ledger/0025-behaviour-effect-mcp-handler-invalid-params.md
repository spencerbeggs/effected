---
id: "0025"
title: "effect: an MCP tool handler's own InvalidParams is answered as invalid input, JSON-RPC -32602 on 2025-06-18"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.7"
  "@effected/mcp-kit": ">=0.15.2"
detect: ["McpSchema\\.InvalidParams|InvalidParams\\("]
changesets: ["mcp-kit-handler-invalid-params-docs"]
---

- **What changed.** `McpServer.registerToolkit`, which `McpServer.toolkit` and `McpToolkit.layer` both use, now passes a handler's own `McpSchema.InvalidParams` through as invalid input instead of treating it as a declared failure. On protocol `2025-06-18` the call is answered with a JSON-RPC `-32602` error, not an `isError` tool result. On `2025-11-25` and the stateless `2026-07-28` it is still an `isError` result with the same text. Probed on both Effect versions, through core's toolkit and through `McpToolkit.layer`.
- **What to check.** Find each tool handler that fails with `InvalidParams`, and each test that asserts its answer. A test on `2025-06-18` that read `result.isError` now finds `result` undefined and `error.code` `-32602`. A union tool registered through core's `McpServer.toolkit` (`McpToolkit.unionTool`) answers its strict-decode failure the same way.
- **What did not change.** The parameter-decode failure was already `-32602` on `2025-06-18`, and the `Accepted params at <path>: …` lines `McpToolkit.layer` appends are unchanged; a handler's own message is left as written when the payload has no unknown key.
