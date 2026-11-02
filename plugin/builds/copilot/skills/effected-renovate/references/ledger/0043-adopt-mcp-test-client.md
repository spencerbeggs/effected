---
id: "0043"
title: Adopt McpTest.makeClient for in-memory MCP server tests
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["StdioClientTransport", "McpHarness"]
---

Core's `McpTest.makeClient` runs an `McpServer`'s registrations over an in-memory protocol and returns a typed client, through the same encoding, routing and middleware as stdio.

Where to look: tests that spawn your MCP server over stdio only to call a tool. Keep a stdio test where the wire itself is what you test (stdout hygiene, process exit).

`McpServer` also gained cache hints (`cacheHints`). The kit did not probe them: read `effect/dist/ai/McpServer.d.ts` before adopting.
