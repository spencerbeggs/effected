---
id: "0051"
title: McpServer encodes declared tool failures through their JSON codec
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.2"
detect: ["Tool\\.make\\(", "McpServer\\.middleware", "failureMode"]
---

Effect 4.1.2 changes what a core `McpServer` sends for a tool's declared failure (Effect-TS/effect#10243). The failure value now goes through `Schema.toCodecJson` of the tool's `failure` schema, as successes already did. This covers both failures raised by the handler and failures it returns under `failureMode: "return"`. A failure carrying a `bigint`, `Map`, `Option` or `Date` used to end in an internal error or lossy output; it now arrives as the JSON-encoded value. A failure that is an `Error` with a non-empty `message` is still sent as that message text.

The same release also changes these:

- Middleware provided outside a combined middleware now runs outside it (#10242).
- Resources, resource templates and prompts registered as plain objects list correctly on the 2026-07-28 protocol (#10244).
- A tool schema that is an identified alias of another identified schema no longer serves a root `$ref` (#10278).

What to do: for each tool with a `failure` schema, check whether a test asserts on the failure's wire text. Check the order of any `McpServer.middleware` stack that relied on the old order. Check against the installed `effect/dist/ai/McpServer.js`. This entry restates the changelog and the source diff; the wire shapes were not probed against a consumer server.

How it shows itself: a test snapshotting a tool failure's `content` or `structuredContent` changes; nothing fails to compile. A server on `@effected/mcp-kit` whose failures are `ToolRefusal` values is unaffected, because those are errors with a message.
