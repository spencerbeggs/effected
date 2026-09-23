---
type: Module
title: "@effected/mcp"
description: The boundary-tier MCP front end — stdio server wiring, tool-failure shaping, JSON-schema input walkers, and a strict-toolkit decorator that names every unknown key in one response — plus an in-process/spawned testing subpath.
status: draft
kind: package
resource: ../../packages/mcp
layer: boundary
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T22:22:55Z
  body_sha256: 3f94b426d6a9215b086f993183a30362952dee947ce8c176e3d966a83871fdc1
---

# @effected/mcp

`@effected/mcp` is the MCP twin of [`@effected/cli`](cli.md) — the boundary
layer for an `effect/unstable/ai` MCP server, never a second MCP framework.
Protocol handling, tool registration and the wire format stay core's; this
package fixes the defaults three consumer repos got wrong independently: an
unhandled failure report landing on stdout (the JSON-RPC wire itself), a
spawned test client that hangs when its child exits, and a smoke test that
closes stdin while a request is still in flight.

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md): IO is discharged through core
contracts (`Stdio`, `ChildProcessSpawner`) required in `R`, never through a
platform package taken as a dependency. It depends on `effect` and
[`@effected/engine`](engine.md), both peers, and never on `@effected/cli` —
the forbidden-edges list in the front-end-kit design holds for this
package exactly as it holds for `cli`: no edge from `mcp` to `cli`, none
from `cli` to `mcp`, none from `mcp` to `workspaces`.

## Public surface

| Export | Contract |
| --- | --- |
| `McpStdio.protocols` | `[McpProtocol.v2026_07_28, v2025_11_25, v2025_06_18]`. Stateless first; never a single entry; `initialize` only matches stateful adapters; a request with no session and no `_meta` falls to `protocols[0]`; at most one stateless adapter. |
| `McpStdio.layer` | `(options: { name; version; instructions?; description?; protocols? }) => Layer<McpServer \| McpServerClient, never, Stdio>`. `McpServer.layerStdio` with `LogToStderr` **merged into its own output** (`Layer.provideMerge`, not `Layer.provide`) and `Layer.orDie`, because an `IllegalArgumentError` from `protocols` is the implementer's own defect (A2). |
| `McpStdio.launch` | `(layer) => Effect<never, E, R>`. Reports a launch failure itself, on stderr, and hides it from `runMain`'s own report, which writes outside anything the program can provide (A1). |
| `McpStdio.teardown` | `Runtime.Teardown`. A success or an interrupt-only exit maps to 0 — stdin reaching EOF would otherwise exit 130. Anything else goes to `Runtime.defaultTeardown`. |
| `ToolFailure` | `message(raw, remediation)` gives `"<raw> <hint>[ Try <suggestedTool>.]"`. `truncate(value, limit?)` echoes caller values safely, `ECHO_LIMIT = 200`, `ENGINE_ECHO_LIMIT = 2000`. `fields` is `{ message: Schema.String, remediation: Remediation }` to spread into a consumer's `Schema.TaggedError`. Folded into the message because core sends an `Error`-instance declared failure as `isError` with message text only (`McpServer.ts:1842-1845`). |
| `ToolInputSchema` | Pure walkers over a served JSON Schema. `unknownKeys(payload, schema)` returns every `UnknownKeysLevel` — `path`, `unknown`, `accepted` — at every depth (`$ref`, `allOf`, discriminated `oneOf`/`anyOf`, `items`/`prefixItems`, `patternProperties`), capped at depth 256. `formatUnknownKeys(levels, options: FormatUnknownKeysOptions)` renders `Unrecognized parameter(s): … Accepted params: …`, capped at 20 keys and 20 levels. `objectRooted(schema)` rewrites a top-level discriminated union to an object root MCP requires. Only `additionalProperties: false` closes a node, matching core's own emission (A6). |
| `McpToolkit.layer` | **Ships (Branch A — probe P1 passed).** `<Tools>(toolkit, options: McpToolkitOptions) => Layer<never, never, Tool.HandlersFor<Tools> \| Exclude<Tool.HandlerServices<Tools>, McpRequestContext>>`. See the dedicated section below. |

`Remediation` and `CurrentDistribution` are [`@effected/engine`](engine.md)
exports this package consumes, not exports of its own.

## `@effected/mcp/testing`

| Export | Contract |
| --- | --- |
| `McpHarness.make` | `(server: Layer<ROut, E, R>, options: McpHarnessOptions) => Effect<McpHarness, E, Scope \| Exclude<R, Stdio>>`. Runs in-process over `Stdio.layerTest` with queues, the queue-backed `Stdio` provided innermost, matching responses by id. In stateless mode it injects `_meta` and uses `server/discover` in place of `initialize`. With `strictStdout` (default `true`), any stdout line that isn't JSON-RPC dies the wait. Every wait races a stop signal and a corruption signal, so none can outlive the server (A3). Operations: `initialize`/`discover`, `request`/`startRequest`/`notify`, `callTool`, `listTools`, `readResource`, `sendRaw`, `awaitOutboundMethod`, `stderrSoFar`, `consoleLogSoFar`, `close` (`Queue.end`, A4). |
| `McpProcess.spawn` | `(command: ChildProcess.Command) => Effect<McpProcess, PlatformError, ChildProcessSpawner \| Scope>`. The test file builds the command with `execPath` and `env`. Reads stdout with `Stream.decodeText` and `Stream.splitLines`. `nextLine` fails with `StreamEnded` at end of stream rather than hanging. `readUntilResponse(id)` returns `{ response, seen }`, because `list_changed` notifications interleave. Also `handshake(protocol?)`, `closeStdin` (`Queue.end`, never `shutdown` — A4), `exitCode`, `stderrSoFar`/`stderrFinal`. |
| `McpProbe.initialize` | `(command, options: McpProbeOptions) => Effect<McpProbeResult, McpTestFailure \| PlatformError, ChildProcessSpawner>`. Keeps stdin open until the id-1 response arrives, then closes. On a `StreamEnded` failure the exit code and stderr are folded into the failure itself, because the caller holds no handle to read them separately (A5). The caller asserts empty stderr and exit 0 — the MCP half of the packed-install proof. |
| `McpTestFailure` | `Schema.TaggedError` shared by every test client (A8, new export not in the original spec table): `reason: "StreamEnded" \| "ServerStopped" \| "NotJsonRpc" \| "ErrorResponse"`, `message: string`. |
| `McpToolAudit.check` | `(tools: ReadonlyArray<ServedTool>, policy: McpToolAuditPolicy) => ReadonlyArray<string>`. A pure sweep over `tools/list` that returns violations, `"<tool>: <what>"` per line. `input: "open" \| "closed" \| "any"`; `requireTitle?`; `requireOutputSchema?`; `objectRootedOutput?` defaults to `true` ([D10](../decisions/mcp-tool-audit-object-rooted-outputs.md)); `maxDescription?`; `requireHints?`. |
| `JsonRpcMessage`, `ServedTool` | The wire-frame and served-tool-listing-entry shapes shared across the testing surface. |

## `McpToolkit` — Branch A ships

Probe P1 (`p1-findings.md`, scratchpad, not a bundle link — the
scratchpad is gitignored and the evidence is summarized here) ran core's
`registerToolkit` under a registration-scoped decorated `McpServer` and
found every criterion green: every tool is listed with re-annotation
closing nested objects, a re-annotated handler still resolves by
`tool.id`, the decorator's pre-check runs before core's own decode and
names every unknown key at every depth in one `McpSchema.InvalidParams`,
handler dependencies still resolve, a declared failure still passes
through, and an explicit `Tool.Strict` false stays open. Seven mutation
checks (dropping the decoration, disabling the pre-check, skipping or
over-applying re-annotation, changing the re-annotated clone's `id`,
breaking a handler dependency, and flipping a handler's success/failure)
each drove the matching criterion red and were reverted. This selects
**Branch A**: `@effected/mcp` ships `McpToolkit`, not a recipe.

`McpToolkit.layer(toolkit, options?)` is the better *report*, not the
rejecter — rejection stays core's. `Tool.Strict` already rejects unknown
keys at decode time, but reports only the first
(`Expected no excess property at ["extra"]`); the decorator runs its own
`ToolInputSchema.unknownKeys` pre-check first and fails with one
`McpSchema.InvalidParams` naming every unknown key path plus the accepted
params, before core ever decodes. `McpToolkitOptions.strict` is `"all"`
(default) or `"annotated"`: `"all"` re-annotates every tool without its
own `Tool.Strict` annotation to strict; `"annotated"` leaves annotation
alone. In both modes an explicit annotation always wins, and a
`Tool.dynamic` tool is never re-annotated — core dies at registration on a
strict dynamic tool, because it cannot strictly validate a raw JSON
Schema. **Only a tool that ends up strict gets the pre-check** — the same
predicate core uses to choose strict decoding
(`Tool.getStrictMode(tool) === true`) gates it, so a lenient tool is never
rejected here even when its raw schema happens to carry
`additionalProperties: false` (A7).

`DEFAULT_STRICT = "all"` — see
[the new Decision](../decisions/mcp-strict-default-for-claude-code.md)
(A10): probe P2 found Claude Code 2.1.281 never places its own protocol
extras inside a tool call's `arguments`, only under the sibling
`params._meta`, so serving every unannotated tool strict by default
rejects nothing a real client sends.

## Spec amendments

The design spec (`docs/superpowers/specs/2026-09-23-front-end-kit-design.md`
§7) is amended in ten places against what shipped:

| # | Amendment | Reason | Citation |
| --- | --- | --- | --- |
| A1 | `McpStdio.launch` reports a launch failure itself, on stderr, rather than merely providing `LogToStderr` around the launched effect. | `runMain`'s own failure report runs via `Effect.tapCause` **outside** the effect the program provides — nothing `Effect.provideService` reaches — and `provideService` restores the ambient context the moment its own effect exits, so `LogToStderr` is already back to its default by the time `runMain`'s tap fires. `launch` instead catches the cause, logs it on stderr itself, and re-raises a `LaunchFailed` marked `[Runtime.errorReported] = false` so `runMain`'s tap skips re-logging it, keeping the original exit code via `[Runtime.errorExitCode]`. Control test: a failing layer's error text lands on stderr, never on stdout/`console.log`. | `Runtime.ts:207-214`, `internal/effect.ts:2205-2213` |
| A2 | `McpStdio.layer` merges `LogToStderr` into its own output (`Layer.provideMerge`), not merely inward (`Layer.provide`). | `provideMerge` puts `LogToStderr` into the layer's own `ROut`, so every layer composed WITH `McpStdio.layer` — not only its own internals — logs to stderr too. | `packages/mcp/src/McpStdio.ts:94` |
| A3 | `McpHarness`'s waits are stop-aware, not merely non-hanging by construction. | Every response wait and `awaitOutboundMethod` races the stop and corrupt `Deferred`s, so a server that stops before responding, or writes a non-JSON-RPC line under `strictStdout`, fails or dies the wait instead of hanging it. | `packages/mcp/src/McpHarness.ts:231-238` |
| A4 | `McpHarness.close` and `McpProcess.closeStdin` are both `Queue.end`, never `Queue.shutdown`. | `Queue.end` drains every frame already offered before closing; `shutdown` would drop an in-flight frame sent immediately before close. | `packages/mcp/src/McpHarness.ts:299`, `packages/mcp/src/McpProcess.ts:178` |
| A5 | `McpProbe.initialize` folds the exit code and stderr into the `McpTestFailure` itself when the stream ends. | The caller holds no separate handle to read them once the probe has failed, so `diagnose` reads `child.exitCode`/`child.stderrFinal` and re-raises a richer `StreamEnded`. | `packages/mcp/src/McpProbe.ts:112-124` |
| A6 | `ToolInputSchema` and `McpToolAudit` both state explicitly: only `additionalProperties: false` closes a node. | A `true` value, an absent value, or a schema-valued `additionalProperties` (a `Record`'s value schema) all leave a node open, matching core's own emission — this line was implicit in the original spec table. | `packages/mcp/src/ToolInputSchema.ts:89`, `packages/mcp/src/McpToolAudit.ts:38-41` |
| A7 | `McpToolkit.layer` ships as Branch A (probe P1 passed), not a probe-gated maybe. | See the dedicated section above. | `p1-findings.md` (SCRATCH, summarized above) |
| A8 | `McpTestFailure` is a new export not in the original spec's testing table. | Every test client (`McpHarness`, `McpProcess`, `McpProbe`) shares one typed failure shape rather than each inventing its own. | `packages/mcp/src/McpTestFailure.ts` |
| A9 | Spec §12 item 1's citation moves from `McpServer.ts:1832` to `McpServer.ts:1835`. | The `decodeOptions` line (`onExcessProperty: "error"`, no `errors: "all"`) sits at line 1835 in the pinned rc.117 tree. | `.repos/effect/packages/effect/src/unstable/ai/McpServer.ts:1835` |
| A10 | `McpToolkit`'s default `strict` mode is `"all"`. | Probe P2's outcome (O1) — see the Decision below. | [D: strict default for Claude Code](../decisions/mcp-strict-default-for-claude-code.md) |

## Upstream gaps and their kit workarounds

Two core gaps drove this design (D2) and remain open upstream as of this
writing; the upstream issue drafts are on hold, by user directive, until
`@effected/mcp` publishes:

- **`Tool.Strict` reports only the first unknown key**, because
  `McpServer.ts`'s strict decode path does not set `errors: "all"`.
  Workaround: `ToolInputSchema`/`McpToolkit`, which walk the served schema
  and report every unknown key at every depth in one response.
- **A tool whose parameters are a top-level union dies at boot**, because
  `McpSchema`'s tool-JSON encoding requires an object root and decodes it
  with `orDie`. Workaround: `ToolInputSchema.objectRooted`, which rewrites
  a discriminated union to an object root before the tool is registered.

## `InvalidParams` per protocol revision

How a rejected call's `McpSchema.InvalidParams` actually reaches the
client differs by revision — `@effected/mcp`'s tests cover every row:

| Revision | Shape |
| --- | --- |
| `2024-11-05` | JSON-RPC error, code `-32602` |
| `2025-03-26` | JSON-RPC error, code `-32602` |
| `2025-06-18` | JSON-RPC error, code `-32602` |
| `2025-11-25` | `isError: true` tool result |
| `2026-07-28` (stateless) | `isError: true` tool result |

## Consumers

[`consumers/okfit`](../consumers/okfit.md) names `Remediation`,
`ToolInputSchema` and `LaunchContext` as belonging in this package
directly, and its MCP remediation helpers as one of three near-identical
copies this package collapses.
[`consumers/vitest-agent`](../consumers/vitest-agent.md) names its two
independent ports of `registerToolkit` as the duplication `McpToolkit`
now targets.

## See also

- [D2: strict MCP input is upstream-first](../decisions/mcp-strict-input-upstream-first.md)
- [D10: `McpToolAudit` enforces object-rooted outputs by default](../decisions/mcp-tool-audit-object-rooted-outputs.md)
- [D: strict default for Claude Code](../decisions/mcp-strict-default-for-claude-code.md)
- [`@effected/engine`](engine.md)
- [`@effected/cli`](cli.md)
