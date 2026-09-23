---
type: Module
title: "@effected/mcp"
description: Design-only record of the boundary-tier MCP front end — stdio server wiring, tool-failure shaping, JSON-schema input walkers, and the probe-gated strict-toolkit decorator — built in phase 2.
status: draft
kind: package
resource: ../../packages/mcp
layer: boundary
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 29fe474b08dac11f4a52fa899230a13aa18bfa78f8d080433426813b93453437
---

# @effected/mcp

**Design-only.** `@effected/mcp` is planned, not built: this record exists
so phase 2 implements against a settled surface rather than a moving
target, per [D2](../decisions/mcp-strict-input-upstream-first.md). It is
the MCP twin of [`@effected/cli`](cli.md) — the boundary layer for an
`effect/unstable/ai` MCP server, never a second MCP framework. Protocol
handling, tool registration and the wire format stay core's; this package
fixes the defaults three consumer repos got wrong independently: an
unhandled failure report landing on stdout (the JSON-RPC wire itself), a
spawned test client that hangs when its child exits, and a smoke test that
closes stdin while a request is still in flight.

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md): IO is discharged through core
contracts (`Stdio`, `ChildProcessSpawner`) required in `R`, never through a
platform package taken as a dependency. It depends on `effect` and
[`@effected/engine`](engine.md), both peers, and never on `@effected/cli`
— the forbidden-edges list in the front-end-kit design holds for this
package exactly as it holds for `cli`: no edge from `mcp` to `cli`, none
from `cli` to `mcp`, none from `mcp` to `workspaces`.

## Public surface (spec §7, verbatim)

| Export | Contract |
| --- | --- |
| `McpStdio.protocols` | `[McpProtocol.v2026_07_28, v2025_11_25, v2025_06_18]`. Stateless first; never a single entry; `initialize` only matches stateful adapters; a request with no session and no `_meta` falls to `protocols[0]`; at most one stateless adapter. |
| `McpStdio.layer` | `(options: { name; version; instructions?; description?; protocols? }) => Layer<McpServer \| McpServerClient, never, Stdio>`. `McpServer.layerStdio` plus `LogToStderr` plus `Layer.orDie`, because an `IllegalArgumentError` from `protocols` is the implementer's own defect. |
| `McpStdio.launch` | `(layer) => Effect<never, E, R>`. `Layer.launch` plus `Effect.provideService(References.LogToStderr, true)` on the *launched effect*, fixing `runMain` reporting failures on stdout (`Runtime.ts:207-214`). |
| `McpStdio.teardown` | `Runtime.Teardown`. A success or an interrupt-only exit maps to 0 — stdin reaching EOF would otherwise exit 130. Anything else goes to `Runtime.defaultTeardown`. |
| `ToolFailure` | `message(raw, remediation)` gives `"<raw> <hint>[ Try <suggestedTool>.]"`. `truncate(value, limit?)` echoes caller values safely, `ECHO_LIMIT = 200`, `ENGINE_ECHO_LIMIT = 2000`. `fields` is `{ message: Schema.String, remediation: Remediation }` to spread into a consumer's `Schema.TaggedError`. Folded into the message because core sends an `Error`-instance declared failure as `isError` with message text only. |
| `ToolInputSchema` | Pure walkers over a served JSON Schema. `unknownKeys(payload, schema)` returns every unknown key at every depth (`allOf`, `oneOf`/`anyOf` by `action`/`kind`, arrays, `prefixItems`) with the accepted keys. `formatUnknownKeys(levels, { echoLimit? })` renders `Unrecognized parameter(s): … Accepted params: …`. `objectRooted(schema)` handles a top-level union. |
| `McpToolkit.layer` | **Built only if probe P1 passes** — see [D2](../decisions/mcp-strict-input-upstream-first.md). `(toolkit, { unknownKeyMessage? })` runs core's `registerToolkit` under a decorated `McpServer` whose `addTool` wraps each `handle` with an `unknownKeys` pre-check raising `McpSchema.InvalidParams`. If the probe fails, this becomes a skill recipe instead. |

`Remediation` and `CurrentDistribution` are [`@effected/engine`](engine.md)
exports this package consumes, not exports of its own.

## `@effected/mcp/testing` (spec §7, verbatim)

| Export | Contract |
| --- | --- |
| `McpHarness.make` | `(server: Layer<never, E, R \| Stdio>, { protocol?, clientInfo?, captureLogs?, strictStdout? }) => Effect<McpHarness, E, Scope \| Exclude<R, Stdio>>`. Runs in-process over `Stdio.layerTest` with queues, the queue-backed `Stdio` provided innermost, matching responses by id. In stateless mode it injects `_meta` and uses `server/discover` in place of `initialize`. With `strictStdout`, any stdout line that isn't JSON-RPC is a defect. Operations: `initialize`/`discover`, `callTool`, `listTools`, `readResource`, `sendRaw`, `awaitOutboundMethod`, `stderrSoFar`, `consoleLogSoFar`, `close` (`Queue.end`). |
| `McpProcess.spawn` | `(command: ChildProcess.Command) => Effect<McpProcess, PlatformError, ChildProcessSpawner \| Scope>`. The test file builds the command with `execPath` and `env`. Reads stdout with `Stream.decodeText` and `Stream.splitLines`. `nextLine` fails at end of stream rather than hanging. `readUntilResponse(id)` returns `{ response, seen }`, because `list_changed` notifications interleave. Also `handshake(protocol?)`, `closeStdin` (`Queue.end`, never `shutdown`), `exitCode`, `stderrFinal`. |
| `McpProbe.initialize` | `(command, { protocol? }) => Effect<{ response; stdout; stderr; exitCode }>`. Keeps stdin open until the id-1 response arrives, then closes. The caller asserts empty stderr and exit 0 — the MCP half of the packed-install proof. |
| `McpToolAudit.check` | `(tools, policy: { input: "open" \| "closed" \| "any"; requireTitle?; requireOutputSchema?; objectRootedOutput? = true; maxDescription?; requireHints? }) => ReadonlyArray<string>`. A pure sweep over `tools/list` that returns violations. Defaults `objectRootedOutput` to `true` — see [D10](../decisions/mcp-tool-audit-object-rooted-outputs.md). |

## Consumers

[`consumers/okfit`](../consumers/okfit.md) names `Remediation`,
`ToolInputSchema` and `LaunchContext` as belonging in this future package
directly, and its MCP remediation helpers as one of three near-identical
copies this package collapses.
[`consumers/vitest-agent`](../consumers/vitest-agent.md) names its two
independent ports of `registerToolkit` as the duplication `McpToolkit`
(if the probe passes) or the upstream-first recipe (if it does not)
targets.

## See also

- [D2: strict MCP input is upstream-first](../decisions/mcp-strict-input-upstream-first.md)
- [D10: `McpToolAudit` enforces object-rooted outputs by default](../decisions/mcp-tool-audit-object-rooted-outputs.md)
- [`@effected/engine`](engine.md)
- [`@effected/cli`](cli.md)
