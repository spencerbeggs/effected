---
name: effect-v4-mcp
description: Use when building, wiring, testing or reviewing an MCP server on Effect v4 — effect/unstable/ai's McpServer, Tool and Toolkit plus the @effected/mcp boundary that keeps stdout the JSON-RPC wire and makes tool failures readable to an agent.
when_to_use: MCP server, McpServer, Tool.make, Toolkit, layerStdio, tools/call, server/discover, initialize, Tool.Strict, unknown keys, isError, structuredContent, InvalidParams, MCP resource, mimeType, stdio server exits 130, JSON-RPC on stdout, McpHarness, McpProbe, crash guard
---

# Effect v4 MCP servers

Core owns the protocol, tool registration and the wire format:
`effect/unstable/ai`'s `McpServer`, `Tool` and `Toolkit` parse requests,
serve JSON Schema, and shape a `tools/call` result. `@effected/mcp` owns the
stdio boundary — keeping every log line and every crash report off stdout,
which is the JSON-RPC wire — plus tool-failure shaping and strict-input
reporting. `@effected/mcp/testing` owns the in-process and spawned test
clients.

| construct | import | reach for it when |
| --- | --- | --- |
| `McpServer`, `Tool`, `Toolkit`, `McpSchema` | `effect/unstable/ai` | declaring the server, its tools, and the protocol-level schemas |
| `McpStdio` | `@effected/mcp` | launching a stdio server without a stray log line or crash report reaching the wire |
| `McpToolkit` | `@effected/mcp` | registering a toolkit strict-by-default, naming every unknown key in one response |
| `ToolFailure` | `@effected/mcp` | folding remediation into a declared failure's message — core sends only `error.message` |
| `ToolInputSchema` | `@effected/mcp` | naming unknown keys in a `Tool.dynamic` tool's raw payload, inside its own handler |
| `Remediation`, `LaunchContext` | `@effected/engine` | a structured `{ hint, suggestedTool? }` shape, or resolving an agent-launched project directory |
| `McpHarness`, `McpProcess`, `McpProbe`, `McpToolAudit` | `@effected/mcp/testing` | testing the server layer in process, a spawned child, a packed install, or auditing what `tools/list` actually serves |

## Standards

- Launch with `McpStdio.launch` and `NodeRuntime.runMain(program, { teardown: McpStdio.teardown })` — never a bare `Layer.launch`.
- Register toolkits through `McpToolkit.layer`, not core's `McpServer.toolkit` directly, for complete unknown-key reporting.
- Fold remediation into a declared failure's message with `ToolFailure` at construction — nothing else reaches the agent.
- Declare every service a handler uses in `Tool.make`'s `dependencies` option.
- Test the server layer in process with `McpHarness`; test a **built** bin with `McpProcess`/`McpProbe`.

## Footguns

- Hand-wiring `McpServer.layerStdio` without `McpStdio.layer` wedges on one bad line: core's stdio decoder throws on a non-JSON line and never trims it, so every later chunk re-throws and the server stops answering while stdin EOF still exits `0` — see [The stdin guard](./references/server-wiring.md#stdin-guard).
- `runMain`'s own failure report runs outside anything the program provides and lands on stdout, the wire — see [`McpStdio.launch`](./references/server-wiring.md).
- Stdin EOF interrupts the main fiber; the default teardown exits `130` — see [`McpStdio.teardown`](./references/server-wiring.md).
- A declared failure reaches the agent as message text only, never `structuredContent` — see [Failures on the wire](./references/tools.md#failures-on-the-wire).
- `InvalidParams` moves to an `isError` tool result on the newer protocol revisions only for a known tool's own bad parameters — an unknown tool or non-object `arguments` stays a JSON-RPC error on every revision — see [Failures on the wire](./references/tools.md#failures-on-the-wire).
- A top-level union `parameters` schema dies the server at registration, not at the first call — see [Failures on the wire](./references/tools.md#failures-on-the-wire).
- `Schema.Struct({})` is not `Tool.EmptyParams` — it fails server registration outright — see [Defining a tool](./references/tools.md#defining-a-tool).
- Closing stdin with a request in flight drops that response — see [`McpStdio.teardown`](./references/server-wiring.md).
- A bare-string resource `content` loses its `mimeType` — see [Resources](./references/server-wiring.md).

## Additional resources

- [server-wiring.md](./references/server-wiring.md) — the complete `main.ts`, `McpStdio.layer`/`launch`/`teardown`, protocol ordering, crash guards, and launch-context project-directory resolution. Load when: assembling or reviewing a server's `main.ts`, or debugging why a failure or a log line reached the wire.
- [tools.md](./references/tools.md) — defining a tool, strict input reporting, failures on the wire, and the `ok: false` structured-remediation envelope. Load when: declaring a `Tool.make`, wiring a `Toolkit`, or a client is seeing the wrong failure shape.
- `effected-packages`' [mcp.md](../effected-packages/references/mcp.md) — the `@effected/mcp` package surface as a routing reference (import table, full API, Usage block). Load when: you need the package-level index rather than the teaching depth here.

Anchors in this skill and its references cite the vendored tag at
`.repos/effect/packages/effect/src/`; a consumer without that tree searches
`node_modules/effect/src` by symbol name instead of by line number.
