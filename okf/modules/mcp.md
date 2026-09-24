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
  at: 2026-09-24T04:46:48Z
  body_sha256: 5b124c94347bdd358eb82df8d636be4f4c750409eb5028441465b19732ddc242
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
| `McpStdio.layer` | `(options: { name; version; instructions?; description?; protocols? }) => Layer<McpServer \| McpServerClient, never, Stdio>`. `McpServer.layerStdio` with `LogToStderr` **merged into its own output** (`Layer.provideMerge`, not `Layer.provide`) and `Layer.orDie`, because an `IllegalArgumentError` from `protocols` is the implementer's own defect (A2). The server's `Stdio` is wrapped by a guard that frames stdin exactly as core's decoder does (one streaming UTF-8 decoder, a BOM stripped only at stream start). A line that is not JSON, or longer than core's cap of 16 Mi UTF-16 code units, is answered with a JSON-RPC `-32700` parse error (`id: null`) and never reaches core's decoder; a line of JSON whitespace is ignored; the server keeps serving after either. The guard's state lives once per `Stdio`, so a partial line held across core's re-subscription to stdin survives, and the guard layer is minted per call, never shared through memoization. One server per layer graph: core's `RpcServer.layerProtocolStdio` is a module constant, so two stdio servers merged into one graph share one protocol and only the first reads stdin. |
| `McpStdio.launch` | `<ROut, E, R>(layer: Layer.Layer<ROut, E, R>) => Effect.Effect<never, Error, R>`. Catches every non-interrupt cause itself and logs it inside the `LogToStderr` scope, then re-fails with a private `LaunchFailed` sentinel carrying `Runtime.errorReported = false` (so `runMain` stays silent) and `Runtime.errorExitCode` copied from the original error (so the exit code survives) (A1). |
| `McpStdio.teardown` | `Runtime.Teardown`. A success or an interrupt-only exit maps to 0 — stdin reaching EOF would otherwise exit 130. Anything else goes to `Runtime.defaultTeardown`. |
| `ToolFailure` | `message(raw, remediation)` gives `"<raw> <hint>[ Try <suggestedTool>.]"`, dropping any empty part so an empty hint never leaves a double space (A10). `truncate(value, limit?)` echoes caller values safely, never splitting a UTF-16 surrogate pair (A10); `ECHO_LIMIT = 200`, `ENGINE_ECHO_LIMIT = 2000`. `fields` is `{ message: Schema.String, remediation: Remediation }` to spread into a consumer's `Schema.TaggedError`. Folded into the message because core sends an `Error`-instance declared failure as `isError` with message text only (`McpServer.ts:1842-1845`). |
| `ToolInputSchema` | Pure walkers over a served JSON Schema. `unknownKeys(payload, schema)` returns every `UnknownKeysLevel` — `path`, `unknown`, `accepted` — at every depth (`$ref`, `allOf`, discriminated `oneOf`/`anyOf`, `items`/`prefixItems`, `patternProperties`), stopping descent at depth 256 (A6). `formatUnknownKeys(levels, options: FormatUnknownKeysOptions)` renders `Unrecognized parameter(s): … Accepted params: …`, echoing at most 20 keys per level and at most 20 levels, each sentence ending with a period (A6). `objectRooted(schema)` rewrites a top-level discriminated union to an object root MCP requires. Only `additionalProperties: false` closes a node — a missing keyword means open, matching core's own emission (A6). |
| `McpToolkit.layer` | **Ships (Branch A — probe P1 passed).** `<Tools>(toolkit, options: McpToolkitOptions) => Layer<never, never, Tool.HandlersFor<Tools> \| Exclude<Tool.HandlerServices<Tools>, McpRequestContext>>`. `options.strict` is `"all"` \| `"annotated"`, defaulted by P2 (A7). See the dedicated section below. |

`Remediation` and `CurrentDistribution` are [`@effected/engine`](engine.md)
exports this package consumes, not exports of its own.

## `@effected/mcp/testing`

| Export | Contract |
| --- | --- |
| `McpHarness.make` | `<ROut, E, R>(server: Layer.Layer<ROut, E, R>, options?) => Effect.Effect<McpHarness, E, Scope \| Exclude<R, Stdio>>` — generic over the server's own output, so it accepts `McpStdio.layer` directly (whose output is `McpServer \| McpServerClient`, not `never`) (A3). Runs in-process over `Stdio.layerTest` with queues, the queue-backed `Stdio` provided innermost, matching responses by id. A caller-supplied `_meta` wins over the fields the harness injects when building a stateless frame. In stateless mode it injects `_meta` and uses `server/discover` in place of `initialize`. With `strictStdout` (default `true`), any stdout line that isn't JSON-RPC dies the wait; every wait races a stop signal and a corruption signal, so none can outlive the server. On a stateful revision, a request other than `initialize` sent before one fails fast with `NotInitialized` rather than reaching the server's opaque `Invalid request metadata`; `sendRaw` is never gated. Operations, including `request`/`startRequest`/`notify` beyond the original spec table (A3): `initialize`/`discover`, `callTool`, `listTools`, `readResource`, `sendRaw`, `awaitOutboundMethod`, `stderrSoFar`, `consoleLogSoFar`, `close` (`Queue.end`, never `shutdown`). Operation errors are typed `McpTestFailure`, a new `./testing` export (A3). Both `captureLogs` and `strictStdout` default to `true` (A3). |
| `McpProcess.spawn` | `(command: ChildProcess.Command) => Effect<McpProcess, PlatformError, ChildProcessSpawner \| Scope>`, returning an `McpProcess` instance (A4). The test file builds the command with `execPath` and `env`. Reads stdout with `Stream.decodeText` and `Stream.splitLines`. `nextLine` and `readUntilResponse` fail with `McpTestFailure` (`StreamEnded` or `NotJsonRpc`) rather than hanging (A4); `readUntilResponse(id)` returns `{ response, seen }`, because `list_changed` notifications interleave. `handshake(protocol?)` always uses id 1 (A4). `closeStdin` is `Queue.end`, never `shutdown`. `stderrSoFar` is added beside `stderrFinal` (A4). `sendRaw(text: string \| Uint8Array)` writes a string (as UTF-8) or bytes to stdin exactly as given, with no JSON encoding and no newline, for frames `send` cannot make: a non-JSON line, a blank line, one frame split across writes, even mid-character. |
| `McpProbe.initialize` | `(command, options: McpProbeOptions) => Effect.Effect<McpProbeResult, McpTestFailure \| PlatformError, ChildProcessSpawner>`, with `stdout` holding the raw lines (A5). Keeps stdin open until the id-1 response arrives, then closes. On a `StreamEnded` failure the exit code and stderr are folded into the failure itself, because the caller holds no handle to read them separately. The caller asserts `response.error === undefined`, empty stderr and exit 0 — the MCP half of the packed-install proof. |
| `McpTestFailure` | `Schema.TaggedError` shared by every test client, introduced as part of A3: `reason: "StreamEnded" \| "ServerStopped" \| "NotJsonRpc" \| "NotInitialized" \| "ErrorResponse"`, `message: string`. `StreamEnded`/`NotJsonRpc` come from the spawned clients; `ServerStopped`/`NotInitialized`/`ErrorResponse` from `McpHarness`, which dies (never raises `NotJsonRpc`) on a non-JSON-RPC line. |
| `McpToolAudit.check` | `(tools: ReadonlyArray<ServedTool>, policy: McpToolAuditPolicy) => ReadonlyArray<string>`. A pure sweep over `tools/list` that returns violations, `"<tool>: <what>"` per line. `input: "open" \| "closed" \| "any"`; `requireTitle?`; `requireOutputSchema?`; `objectRootedOutput?` defaults to `true` ([D10](../decisions/mcp-tool-audit-object-rooted-outputs.md)); `maxDescription?`; `requireHints?`. **Reports a duplicate tool name under every policy**, independent of `input`/`requireTitle`/etc. (A8). |
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
Schema (A7). **Only a tool that ends up strict gets the pre-check** — the
same predicate core uses to choose strict decoding
(`Tool.getStrictMode(tool) === true`) gates it, so a lenient tool is never
rejected here even when its raw schema happens to carry
`additionalProperties: false`.

`DEFAULT_STRICT = "all"` — see
[the new Decision](../decisions/mcp-strict-default-for-claude-code.md)
(A7): probe P2 found Claude Code 2.1.281 never places its own protocol
extras inside a tool call's `arguments`, only under the sibling
`params._meta`, so serving every unannotated tool strict by default
rejects nothing a real client sends.

## Spec amendments

Made in the phase-2 plan (`docs/superpowers/plans/2026-09-23-front-end-kit-phase-2.md`,
"Spec amendments") and applied here and to the design spec
(`docs/superpowers/specs/2026-09-23-front-end-kit-design.md` §7/§12) in Task 11.
These are the binding A1–A10; the prose below also carries the
implementation-driven refinements the later tasks made on top of them.

| # | Amendment | Citation |
| --- | --- | --- |
| A1 | `McpStdio.launch` signature and mechanism. The spec's `Layer.launch` plus `Effect.provideService(References.LogToStderr, true)` on the launched effect cannot fix `runMain`: `makeRunMain` wraps the program in `Effect.tapCause(effect, ... Effect.logError(cause))` **outside** the program, and `provideService` restores the previous context when its own effect exits, so the outer `logError` sees `LogToStderr = false` and the default logger writes through `console.log`. The fix: `launch` catches every non-interrupt cause itself and logs it inside the `LogToStderr` scope, then re-fails with a private `LaunchFailed` sentinel carrying `Runtime.errorReported = false` (so `runMain` stays silent) and `Runtime.errorExitCode` copied from the original error (so the exit code survives). Signature: `<ROut, E, R>(layer: Layer.Layer<ROut, E, R>) => Effect.Effect<never, Error, R>`. | `Runtime.ts:207-214`, `internal/effect.ts:2205-2213`, `:2348-2352`, `:6829-6833`, `Runtime.ts:399-407`, `Runtime.ts:311-319` |
| A2 | `McpStdio.layer` uses `Layer.provideMerge` for `LogToStderr`, so the reference is also an *output* — it reaches layers composed with `McpStdio.layer`, not only `layerStdio` itself. | `packages/mcp/src/McpStdio.ts:94` |
| A3 | `McpHarness.make` is generic over the server's output: `<ROut, E, R>(server: Layer.Layer<ROut, E, R>, options?) => Effect.Effect<McpHarness, E, Scope \| Exclude<R, Stdio>>` — the spec's `Layer<never, …>` rejects `McpStdio.layer`, whose output is `McpServer \| McpServerClient`. `McpHarness` is the class; `make` returns an instance. Added operations: `request`, `startRequest`, `notify`. Operation errors are typed `McpTestFailure`, a new `./testing` export. Both `captureLogs` and `strictStdout` default to `true`. Implementation refinement: a caller-supplied `_meta` wins over the fields the harness injects, and every wait races a stop signal and a corruption signal so none can outlive the server. | `packages/mcp/src/McpHarness.ts` |
| A4 | `McpProcess`: `spawn` returns an `McpProcess` instance. `nextLine` and `readUntilResponse` fail with `McpTestFailure` (`StreamEnded` or `NotJsonRpc`). `handshake` always uses id 1. `stderrSoFar` is added beside `stderrFinal`. | `packages/mcp/src/McpProcess.ts` |
| A5 | `McpProbe.initialize` is typed `Effect.Effect<McpProbeResult, McpTestFailure \| PlatformError, ChildProcessSpawner>`, and its `stdout` field holds the raw lines. | `packages/mcp/src/McpProbe.ts` |
| A6 | `ToolInputSchema`: only `additionalProperties: false` closes a node — that is JSON Schema's own rule, and it matches what core emits (a missing keyword means open; vitest-agent's own walker had treated a missing keyword as closed). `patternProperties` is honoured. The payload walk stops descending at depth 256. `formatUnknownKeys` echoes at most 20 keys per level and at most 20 levels, and ends each sentence with a period. | `internal/schema/toJsonSchemaDocument.ts:501-518`, `packages/mcp/src/ToolInputSchema.ts` |
| A7 | `McpToolkit.layer` (Branch A) gains `strict?: "all" \| "annotated"`, with the default set by P2 (O1 → `"all"`). An explicit `Tool.Strict` annotation, true or false, always wins. A dynamic tool is never re-annotated, because a strict dynamic tool dies at registration. Implementation refinement: the pre-check is gated on the same predicate core uses to choose strict decoding (`Tool.getStrictMode(tool) === true`), so only a tool that ends up strict gets the pre-check. | `McpServer.ts:1830-1834`, [D: strict default for Claude Code](../decisions/mcp-strict-default-for-claude-code.md) |
| A8 | `McpToolAudit.check` reports a duplicate tool name under **every** policy, independent of `input`/`requireTitle`/etc. | `packages/mcp/src/McpToolAudit.ts:107` |
| A9 | Spec §12 citation fix. The strict decode options are built at `McpServer.ts:1835`; line `:1832` is the dynamic-tool die. The first-key-only loop is `SchemaAST.ts:2930-2955`. | `.repos/effect/packages/effect/src/unstable/ai/McpServer.ts:1835`, `SchemaAST.ts:2930-2955` |
| A10 | `ToolFailure.message` drops any empty part, so an empty hint produces no double space. `truncate` never splits a UTF-16 surrogate pair. | `packages/mcp/src/ToolFailure.ts` |

## Upstream gaps and their kit workarounds

The first two core gaps drove this design (D2); the third was found in the
phase-4 review. All three remain open upstream as of this writing; the
upstream issue drafts are on hold, by user directive, until `@effected/mcp`
publishes:

- **`Tool.Strict` reports only the first unknown key**, because
  `McpServer.ts`'s strict decode path does not set `errors: "all"`.
  Workaround: `ToolInputSchema`/`McpToolkit`, which walk the served schema
  and report every unknown key at every depth in one response.
- **A tool whose parameters are a top-level union dies at boot**, because
  `McpSchema`'s tool-JSON encoding requires an object root and decodes it
  with `orDie`. Workaround: `ToolInputSchema.objectRooted`, which rewrites
  a raw JSON Schema discriminated union to an object root, registered as a
  `Tool.dynamic` tool whose handler runs `unknownKeys` on the raw payload.
- **One stdin line that is not JSON stops a stdio server reading for
  good**, and no `-32700` is sent. `McpServer.layerStdio`'s NDJSON decoder
  (`RpcSerialization.makeNdjson`) runs `JSON.parse` on each line inside its
  read loop and throws before it trims the consumed lines from its buffer.
  The bad line stays at the buffer's head, and the parser is built once per
  protocol, outside the stdin stream that `RpcServer.makeProtocolStdio`
  retries. So each later chunk re-throws on the same line: the error is
  logged once per chunk, no request after it is answered, and stdin EOF
  still exits 0. A blank line does the same, since `JSON.parse("")` throws,
  and so does a U+FEFF opening any line but the first: core's streaming
  decoder strips a byte-order mark only at the start of the stream. A line
  over the 16 Mi-code-unit cap fails with `MaxBufferSizeExceeded`, after
  `failMaxBufferSize` has cleared the buffer, so the rest of that line
  arrives as a fresh line with no answer, and core never replies to the
  client either way.
  Workaround: `McpStdio.layer` provides the server a `Stdio` whose `stdin`
  frames the stream as core does and forwards only complete lines that
  parse as JSON and fit the cap. It answers every other non-blank line with
  the `-32700` frame on `stdout` (an over-cap line once, as it passes the
  cap, then discarding to its newline) and drops JSON-whitespace lines.
  The serialization cannot be swapped instead: `layerStdio` provides it
  internally.

## `InvalidParams` per protocol revision

How a rejected call's `McpSchema.InvalidParams` actually reaches the
client differs by revision. `@effected/mcp`'s tests cover the three
revisions `McpStdio.protocols` serves (`2025-06-18`, `2025-11-25`,
`2026-07-28`); the two older rows record core's own adapters, untested
here:

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
