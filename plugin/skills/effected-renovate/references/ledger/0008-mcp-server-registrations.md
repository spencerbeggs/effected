---
id: "0008"
title: McpServer registrations go through the transport
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["McpServer\\.", "McpServerClient"]
---

Code that builds an `McpServer` directly on core changes in three ways:

- Registrations pass through the transport's `registrations` option instead of being merged beside it.
- Handler services needed at construction are captured with `Layer.unwrap`, not `Layer.provide`.
- A tool's declared `dependencies` become per-request `McpRequest<"Requires", S>` requirements, met by `McpServer` middleware.

A toolkit merged beside the transport with `Layer.mergeAll` now needs `Layer.provide(McpServer.McpServer.layer)`, because `McpServer.toolkit` requires `McpServer`. Prefer `registrations`.

How it shows itself: the compiler reports an unmet `McpRequest` requirement or a missing `McpServer`. If the server runs on `@effected/mcp`, read entry 0034 as well. Check against the installed `effect/dist/ai/McpServer.d.ts`.
