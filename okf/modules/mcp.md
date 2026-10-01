---
type: Module
title: "@effected/mcp"
description: The boundary-tier MCP front end — stdio server wiring with a JSON-RPC stdin guard, tool-failure shaping, JSON-schema input walkers for Tool.dynamic tools, and strict-by-default toolkit registration — plus an in-process/spawned testing subpath.
status: draft
kind: package
resource: ../../packages/mcp
layer: boundary
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: 63accc47d5687f80d63ea50548f6d1be6f12687ad9c6d5a83212e9638139d22b
---

# @effected/mcp

`@effected/mcp` is the MCP twin of [`@effected/cli`](cli.md) — the boundary
layer for an `effect/ai` MCP server, never a second MCP framework.
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
| `McpStdio.layer` | `(options: { name; version; instructions?; description?; protocols? }) => Layer<McpServer \| McpServerClient, never, Stdio>`. `McpServer.layerStdio` with `LogToStderr` **merged into its own output** (`Layer.provideMerge`, not `Layer.provide`) and `Layer.orDie`, because an `IllegalArgumentError` from `protocols` is the implementer's own defect (A2). The server's `Stdio` is wrapped by a guard that frames stdin exactly as core's decoder does (one streaming UTF-8 decoder, a BOM stripped only at stream start). A line that is not JSON, or longer than core's cap of 16 Mi UTF-16 code units, is answered with a JSON-RPC `-32700` parse error (`id: null`) and never reaches core's decoder. A line that is JSON but no JSON-RPC message core can handle is answered with `-32600` Invalid Request (`id: null`, code from `McpSchema.INVALID_REQUEST_ERROR_CODE`): a value that is neither an object nor an array, an object whose `method` is not a string and whose `id` is absent or `null`, and an object with neither `method` nor `id`. Arrays (core answers a batch `-32600` itself), responses (an `id`, no `method`) and requests with an `id` go to core. A line whose `method` starts with `@effect/rpc/` never reaches core, whose JSON-RPC decoder reads one without an `id` as its own RPC control message (`@effect/rpc/Eof` alone silently stops the server): such a request is answered `-32601` Method not found echoing its `id` (`McpSchema.METHOD_NOT_FOUND_ERROR_CODE`), and such a notification is dropped; a control method inside a batch array is harmless and goes to core with the array. A line of JSON whitespace is ignored. Core itself skips every line the guard answers and keeps serving, but replies to none of them; the guard exists to send the replies JSON-RPC 2.0 requires, and to keep the control methods off the wire. Guard replies are id-matched, not ordered: one can reach stdout before core's answer to an earlier line. The guard's state lives once per `Stdio`, so a partial line held across core's re-subscription to stdin survives, and the guard layer is minted per call, never shared through memoization. One server per layer memo map: core's `RpcServer.layerProtocolStdio` is a module constant, so two stdio servers whose builds share a memo map share one protocol and only the first reads stdin. Merging them into one graph shares the map, and so does building or providing the second under the first's `Effect.provide`, since nested `Layer.build` and `Effect.provide` fork the ambient memo map; the tool registry (core's `McpServer.layer`, also a module constant) is shared the same way. Isolate each by wrapping its whole bundle (its toolkit layers together with `McpStdio.layer`, plus its `Stdio` if per server) in `Layer.fresh`, or with its own `ManagedRuntime`, `Effect.provide(layer, { local: true })` or process. Never put the `Layer.fresh` boundary between a toolkit and `McpStdio.layer`: fresh around `McpStdio.layer` alone builds a second, empty registry and the server serves no tools. Code after a completed `Effect.provide` of a stdio server never runs: core's stdio protocol interrupts the fiber that built it when its stdin loop ends. |
| `McpStdio.launch` | `<ROut, E, R>(layer: Layer.Layer<ROut, E, R>) => Effect.Effect<never, Error, R>`. Catches every non-interrupt cause itself and logs it inside the `LogToStderr` scope, then re-fails with a private `LaunchFailed` sentinel carrying `Runtime.errorReported = false` (so `runMain` stays silent) and `Runtime.errorExitCode` copied from the original error (so the exit code survives) (A1). |
| `McpStdio.teardown` | `Runtime.Teardown`. A success or an interrupt-only exit maps to 0 — stdin reaching EOF would otherwise exit 130. Anything else goes to `Runtime.defaultTeardown`. |
| `ToolFailure` | `message(raw, remediation)` gives `"<raw> <hint>[ Try <suggestedTool>.]"`, dropping any empty part so an empty hint never leaves a double space (A10). `truncate(value, limit?)` echoes caller values safely, never splitting a UTF-16 surrogate pair (A10); `ECHO_LIMIT = 200`, `ENGINE_ECHO_LIMIT = 2000`. `fields` is `{ message: Schema.String, remediation: Remediation }` to spread into a consumer's `Schema.TaggedError`. Folded into the message because core sends an `Error`-instance declared failure as `isError` with message text only (`McpServer.ts:1842-1845`). |
| `ToolInputSchema` | Pure walkers over a served JSON Schema. `unknownKeys(payload, schema)` returns every `UnknownKeysLevel` — `path`, `unknown`, `accepted`, and `acceptedPatterns` when the level also accepts keys through `patternProperties` — at every depth (`$ref`, `allOf`, discriminated `oneOf`/`anyOf`, `items`/`prefixItems`, `patternProperties`), stopping descent at depth 256 (A6). `formatUnknownKeys(levels, options: FormatUnknownKeysOptions)` renders `Unrecognized parameter(s): … Accepted params: …`, then `Accepted keys matching: …` for a level with patterns (a pattern-only level names its patterns alone, never `Accepted params: (none).`), echoing at most 20 keys and 20 patterns per level and at most 20 levels, each sentence ending with a period (A6). Its use is a `Tool.dynamic` tool's raw payload, which core never validates strictly; a `Tool.make` tool's strict decode already names every bad key and field. A pattern-keyed `Schema.Record` is served with `patternProperties` only when its key RegExp has the `u` flag; without it core serves the record open and the walk accepts every key. `objectRooted(schema)` rewrites a top-level discriminated union to an object root MCP requires. Only `additionalProperties: false` closes a node — a missing keyword means open, matching core's own emission (A6). |
| `ToolOutputSchema` | `objectRooted<S extends Schema.Top>(schema: S): S` adds `type: "object"` beside a union success schema's root `anyOf` through an always-passing filter, so core serves the `outputSchema` on every revision instead of dropping it (stateful) or serving a bare `anyOf` (stateless). Order-independent against `.annotate({ identifier })`: a check added after an identifier would start an unnamed node, so the identifier the schema resolves is re-annotated onto the new check. Idempotent via a marker annotation on the filter. Works on the Effect schema, unlike `ToolInputSchema.objectRooted`, which rewrites JSON Schema. |
| `ToolRefusal` | `Schema.TaggedError` `"ToolRefusal"` on `ToolFailure.fields`; `ToolRefusal.refuse(reason, remediation)` folds the remediation into `message` with `ToolFailure.message`. The constructor stays the plain field constructor, because a schema class decodes through it. Exists because core scrubs an undeclared failure or a defect to "Tool execution failed due to an internal server error.", so an agent-actionable refusal must be declared. It lives in its own module: `ToolFailure` importing it would be an import cycle. |
| `McpToolkit.unionTool` / `unionHandler` | `unionTool(name, { description?, parameters, success?, failure?, dependencies? })` returns a `UnionTool`: a `Tool.dynamic` served with `Schema.toJsonSchemaDocument(parameters, { onExcessProperty: "error" })`, definitions as `$defs`, through `ToolInputSchema.objectRooted` (byte-identical to vitest-agent's hand-rolled pipeline, pinned by a test), with `failure` unioned with `McpSchema.InvalidParams` and the union kept in a private `UnionParameters` annotation plus a `unionParameters` property. `UnionTool` redeclares `annotate`/`addDependency` to return `UnionTool`, so chaining keeps the union (core's `clone` copies own properties). `unionHandler(tool, handler, options?)` and `McpToolkit.layer`'s `addTool` decorator share one private `decodeUnionPayload`: the union's decode with the options core gives a strict `Tool.make` tool (`onExcessProperty: "error"`, `errors: "all"`), so the discriminant picks the member and one `InvalidParams`, in core's `ToolParameterValidationError` wording, names every excess, missing and invalid field of it, followed by one `Accepted params at <path>: …` line per payload level carrying an unknown key (the same lines `McpToolkit.layer` appends to core's report). `UnionHandlerOptions.unknownKeyMessage` is deprecated and ignored. A test pins a direct call, `McpServer.toolkit` and `McpToolkit.layer` to byte-identical text. The decorator recognises the annotation and runs that check in front of `registration.handle`, outside core's handler, so a rejection lands where a `Tool.make` decode failure does: `-32602` on `2025-06-18`, `isError` later. Under plain `McpServer.toolkit` the handler's `InvalidParams` is a declared failure, `isError` on every revision. The general handler-raised `InvalidParams` side channel is deferred. |
| `McpStdio.launch` `onReady` | `launch(layer, { onReady? })`: `Effect.scoped(Layer.build(layer) → onReady → Effect.never)`, `Layer.launch`'s own shape with the ready signal between build and wait. "Ready" means the whole graph has built, so the stdin loop is forked (serving), before any `initialize`. |
| `McpGuard.run` (`./guard`) | Leaf entrypoint with no static runtime import (pinned by a reachability test; the built `McpGuard.js` has none, and `internal/guardLaunch.js` stays a separate, dynamically imported module). Registers `uncaughtException`/`unhandledRejection` on a structural `McpGuardHost` (`on`, `emit`, `stderr`, `exit`; Node's `process` satisfies it, pinned by a compile-time test with a control), awaits `load()`, then dynamically imports `internal/guardLaunch.ts`, which runs `runMain(McpStdio.launch(layer, { onReady }), { teardown: McpStdio.teardown })`. Policy `onUncaught: "exit" \| "exitBeforeConnect"`, `onRejection: "exit" \| "exitBeforeConnect" \| "log"`, both defaulting to `"exit"`. A `load()` rejection is `startup failed` plus exit 1 under every policy. `format` from `load()` upgrades the dependency-free fallback formatter, which is itself the fallback if `format` throws. `injectCrash: { at: "load" \| "connected", kind: "uncaughtException" \| "unhandledRejection" }` drives either half of the policy end to end. It is raised through `McpGuardHost.emit` (typed to what Node's `process.emit` satisfies; a rejection carries an already-handled rejected promise) on a `setTimeout(0)` tick, never as a real throw or unhandled promise, so a host double exercises the same listener logic as `process` (under `process`, every listener registered for the event sees it, not only the guard's). Genuine post-connect crashes are pinned separately: `guard-main.ts --genuine-crash=<kind>` wraps `process` so the connected-point `emit` becomes a real deferred throw or an uncaught `Promise.reject`, routed by Node itself. `"load"` raises it after both listeners are installed and awaits the emit before calling `load()`, so the pre-connect policy applies deterministically and the fallback formatter reports it; the wait settles either way, rejecting `run` with whatever a double's throwing `exit` threw, so it never hangs. `"connected"` raises it after `onReady`, dropping a double's `exit` throw. Unset, or any other `at`/`kind`, it is inert. It replaced the unreleased `injectCrashAfterConnect?: string`. |
| `McpToolkit.layer` | **Ships (Branch A — probe P1 passed).** `<Tools>(toolkit, options: McpToolkitOptions) => Layer<never, never, Tool.HandlersFor<Tools> \| Exclude<Tool.HandlerServices<Tools>, McpRequestContext>>`. `options.strict` is `"all"` \| `"annotated"`, defaulted by P2 (A7); `options.unknownKeyMessage` is deprecated and ignored. See the dedicated section below. |

`Remediation` and `CurrentDistribution` are [`@effected/engine`](engine.md)
exports this package consumes, not exports of its own.

## `@effected/mcp/testing`

| Export | Contract |
| --- | --- |
| `McpHarness.make` | `<ROut, E, R>(server: Layer.Layer<ROut, E, R>, options?) => Effect.Effect<McpHarness, E, Scope \| Exclude<R, Stdio>>` — generic over the server's own output, so it accepts `McpStdio.layer` directly (whose output is `McpServer \| McpServerClient`, not `never`) (A3). Runs in-process over `Stdio.layerTest` with queues, the queue-backed `Stdio` provided innermost, matching responses by id. A caller-supplied `_meta` wins over the fields the harness injects when building a stateless frame. In stateless mode it injects `_meta` and uses `server/discover` in place of `initialize`. With `strictStdout` (default `true`), any stdout line that isn't JSON-RPC dies the wait; every wait races a stop signal and a corruption signal, so none can outlive the server. On a stateful revision, a request other than `initialize` or `ping` sent before `initialize` fails fast with `NotInitialized` rather than reaching the server's opaque refusal: `-32602 Invalid request metadata` when a stateless adapter is listed first, as in `McpStdio.protocols`, or `-32603 Internal error` when only stateful revisions are served. `ping` passes, because the server answers it `{}` before `initialize`; `sendRaw` is never gated. Passing the server layer composed with a bundled platform layer such as `NodeServices.layer` (`@effect/platform-node`) loses the harness's `Stdio` the same way a directly-provided one does — the bundle's own `Stdio` wins and every wait hangs to timeout; compose the individual platform layers the server needs (`FileSystem`, `Path`, `ChildProcessSpawner`, `Crypto`, `Terminal`) and leave `Stdio` out. Operations, including `request`/`startRequest`/`notify` beyond the original spec table (A3): `initialize`/`discover`, `initializeWith(protocolVersion)` (an `initialize` asking for another stateful revision than the harness speaks, then `notifications/initialized` only when the response carries no error; the response is returned whole. A stateful server counter-offers `2025-11-25` for an unknown version or the stateless `2026-07-28`, never refusing; a stateless harness gets `-32601` Method not found, with no notification sent), `sentSoFar` (every frame written to stdin, in order), `callTool`, `listTools`, `listResources`, `readResource`, `sendRaw`, `awaitOutboundMethod`, `stderrSoFar`, `consoleLogSoFar`, `close` (`Queue.end`, never `shutdown`). `listResources` mirrors `listTools`: `resources/list`'s resources, a JSON-RPC error failing typed with `ErrorResponse`; `readResource(uri)` mirrors `callTool`, returning the whole `resources/read` response so a caller inspects a `McpSchema.InvalidParams`-shaped error itself. The server is built with a fresh layer memo map (`Layer.buildWithMemoMap` over `Layer.makeMemoMapUnsafe()`), never the ambient one, so a harness made under another stdio server's `Effect.provide` still serves its own. Never pass a server layer that provides a layer the test also provides and then reads — the layer is built twice, so tools write to one instance and the test reads the other; leave the service in the server layer's requirements and provide it once from the test, or build it once and pass `Layer.succeed(Tag, value)`. Operation errors are typed `McpTestFailure`, a new `./testing` export (A3). Both `captureLogs` and `strictStdout` default to `true` (A3). |
| `McpProcess.spawn` | `(command: ChildProcess.Command) => Effect<McpProcess, PlatformError, ChildProcessSpawner \| Scope>`, returning an `McpProcess` instance (A4). The test file builds the command with `execPath` and `env`. Reads stdout with `Stream.decodeText` and `Stream.splitLines`. `nextLine` and `readUntilResponse` fail with `McpTestFailure` (`StreamEnded` or `NotJsonRpc`) rather than hanging (A4); `readUntilResponse(id)` returns `{ response, seen }`, because `list_changed` notifications interleave. `handshake(protocol?)` always uses id 1 (A4). `closeStdin` is `Queue.end`, never `shutdown`. `stderrSoFar` is added beside `stderrFinal` (A4). `sendRaw(text: string \| Uint8Array)` writes a string (as UTF-8) or bytes to stdin exactly as given, with no JSON encoding and no newline, for frames `send` cannot make: a non-JSON line, a blank line, one frame split across writes, even mid-character. |
| `McpProbe.initialize` | `(command, options: McpProbeOptions) => Effect.Effect<McpProbeResult, McpTestFailure \| PlatformError, ChildProcessSpawner>`, with `stdout` holding the raw lines (A5). Keeps stdin open until the id-1 response arrives, then closes. On a `StreamEnded` failure the exit code and stderr are folded into the failure itself, because the caller holds no handle to read them separately. The caller asserts `response.error === undefined`, empty stderr and exit 0 — the MCP half of the packed-install proof. |
| `McpTestFailure` | `Schema.TaggedError` shared by every test client, introduced as part of A3: `reason: "StreamEnded" \| "ServerStopped" \| "NotJsonRpc" \| "NotInitialized" \| "ErrorResponse"`, `message: string`. `StreamEnded`/`NotJsonRpc` come from the spawned clients; `ServerStopped`/`NotInitialized` (any request but `ping` before `initialize`, stateful revisions only)/`ErrorResponse` from `McpHarness`, which dies (never raises `NotJsonRpc`) on a non-JSON-RPC line. |
| `McpToolAudit.check` | `(tools: ReadonlyArray<ServedTool>, policy: McpToolAuditPolicy) => ReadonlyArray<string>`. A pure sweep over `tools/list` that returns violations, `"<tool>: <what>"` per line. `input: "open" \| "closed" \| "any"`; `requireTitle?`; `requireOutputSchema?`; `objectRootedOutput?` defaults to `true` ([D10](../decisions/mcp-tool-audit-object-rooted-outputs.md)); `maxDescription?`; `requireHints?`. A missing `outputSchema` (under `requireOutputSchema`) and a non-object root whose schema is a union (`anyOf`/`oneOf`) both name `ToolOutputSchema.objectRooted` as the fix: a union success schema is dropped on stateful revisions and served bare on the stateless one. **Reports a duplicate tool name under every policy**, independent of `input`/`requireTitle`/etc. (A8). Under `input: "closed"`, an open node that is a pattern-keyed `Schema.Record` served without its key check (a schema-valued `additionalProperties` beside a `propertyNames`) gets a hint naming the RegExp `u` flag as the fix. |
| `JsonRpcMessage`, `ServedTool`, `ServedResource` | The wire-frame, served-tool-listing-entry and served-resource-listing-entry shapes shared across the testing surface. |

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
**Branch A**: `@effected/mcp` ships `McpToolkit`, not a recipe. The
pre-check P1 proved has since been retired
([successor decision](../decisions/mcp-strict-input-reported-by-core.md)):
core's own strict decode now reports everything it reported, and more.

`McpToolkit.layer(toolkit, options?)` is policy over core's registration,
not a second rejecter. Rejection and its report are core's: a strict tool
is decoded with `onExcessProperty: "error"` and `errors: "all"`
(`ai/McpServer.ts:1844-1847`), so one `McpSchema.InvalidParams` names every
excess key at every depth together with every missing or invalid field
(`Invalid parameters for tool 'x': Expected no excess property` /
`at ["extra"]`, `Missing key` / `at ["name"]`, …). The layer runs core's
`registerToolkit` unchanged under a registration-scoped `McpServer` whose
`addTool` puts the union decode in front of a `McpToolkit.unionTool`'s
handler and wraps every other registration's `handle` so that core's
`InvalidParams`, the failure it raises only for bad parameters, leaves with
lines appended after core's report, never in place of it: one
`Accepted params at <path>: …` per payload level that carries a key the
served input schema does not accept (`Accepted params at the root: query, filter.`,
`Accepted params at ["filter"]: kind, tag.`), the path written as core
writes it, with `keys matching <pattern>` from `UnknownKeysLevel.acceptedPatterns`,
and `This tool accepts no params.` for a zero-parameter tool. A failure
with no unknown key passes through unchanged. The list is a consumer
contract: vitest-agent documents it as what lets an agent fix a call
without re-reading the tool description
([successor decision](../decisions/mcp-strict-input-reported-by-core.md)).
`McpToolkitOptions.strict` is `"all"` (default) or `"annotated"`: `"all"`
re-annotates every tool without its own `Tool.Strict` annotation to strict;
`"annotated"` leaves annotation alone. In both modes an explicit
annotation always wins, and a `Tool.dynamic` tool is never re-annotated —
core dies at registration on a strict dynamic tool, because it cannot
strictly validate a raw JSON Schema (A7). `McpToolkitOptions.unknownKeyMessage`
is deprecated and ignored: the appended lines are fixed text.

`DEFAULT_STRICT = "all"` — see
[the new Decision](../decisions/mcp-strict-default-for-claude-code.md)
(A7): probe P2 found Claude Code 2.1.281 never places its own protocol
extras inside a tool call's `arguments`, only under the sibling
`params._meta`, so serving every unannotated tool strict by default
rejects nothing a real client sends.

## Spec amendments

Made while building phase 2, each correcting the phase's original design
against core's source. These are the binding A1–A10, each with its citation
in the table; the prose below also carries the
implementation-driven refinements the later tasks made on top of them.

| # | Amendment | Citation |
| --- | --- | --- |
| A1 | `McpStdio.launch` signature and mechanism. The spec's `Layer.launch` plus `Effect.provideService(References.LogToStderr, true)` on the launched effect cannot fix `runMain`: `makeRunMain` wraps the program in `Effect.tapCause(effect, ... Effect.logError(cause))` **outside** the program, and `provideService` restores the previous context when its own effect exits, so the outer `logError` sees `LogToStderr = false` and the default logger writes through `console.log`. The fix: `launch` catches every non-interrupt cause itself and logs it inside the `LogToStderr` scope, then re-fails with a private `LaunchFailed` sentinel carrying `Runtime.errorReported = false` (so `runMain` stays silent) and `Runtime.errorExitCode` copied from the original error (so the exit code survives). Signature: `<ROut, E, R>(layer: Layer.Layer<ROut, E, R>) => Effect.Effect<never, Error, R>`. | `Runtime.ts:207-214`, `internal/effect.ts:2205-2213`, `:2348-2352`, `:6829-6833`, `Runtime.ts:399-407`, `Runtime.ts:311-319` |
| A2 | `McpStdio.layer` uses `Layer.provideMerge` for `LogToStderr`, so the reference is also an *output* — it reaches layers composed with `McpStdio.layer`, not only `layerStdio` itself. | `packages/mcp/src/McpStdio.ts:94` |
| A3 | `McpHarness.make` is generic over the server's output: `<ROut, E, R>(server: Layer.Layer<ROut, E, R>, options?) => Effect.Effect<McpHarness, E, Scope \| Exclude<R, Stdio>>` — the spec's `Layer<never, …>` rejects `McpStdio.layer`, whose output is `McpServer \| McpServerClient`. `McpHarness` is the class; `make` returns an instance. Added operations: `request`, `startRequest`, `notify`. Operation errors are typed `McpTestFailure`, a new `./testing` export. Both `captureLogs` and `strictStdout` default to `true`. Implementation refinement: a caller-supplied `_meta` wins over the fields the harness injects, and every wait races a stop signal and a corruption signal so none can outlive the server. | `packages/mcp/src/McpHarness.ts` |
| A4 | `McpProcess`: `spawn` returns an `McpProcess` instance. `nextLine` and `readUntilResponse` fail with `McpTestFailure` (`StreamEnded` or `NotJsonRpc`). `handshake` always uses id 1. `stderrSoFar` is added beside `stderrFinal`. | `packages/mcp/src/McpProcess.ts` |
| A5 | `McpProbe.initialize` is typed `Effect.Effect<McpProbeResult, McpTestFailure \| PlatformError, ChildProcessSpawner>`, and its `stdout` field holds the raw lines. | `packages/mcp/src/McpProbe.ts` |
| A6 | `ToolInputSchema`: only `additionalProperties: false` closes a node — that is JSON Schema's own rule, and it matches what core emits (a missing keyword means open; vitest-agent's own walker had treated a missing keyword as closed). `patternProperties` is honoured. The payload walk stops descending at depth 256. `formatUnknownKeys` echoes at most 20 keys per level and at most 20 levels, and ends each sentence with a period. | `internal/schema/toJsonSchemaDocument.ts:501-518`, `packages/mcp/src/ToolInputSchema.ts` |
| A7 | `McpToolkit.layer` (Branch A) gains `strict?: "all" \| "annotated"`, with the default set by P2 (O1 → `"all"`). An explicit `Tool.Strict` annotation, true or false, always wins. A dynamic tool is never re-annotated, because a strict dynamic tool dies at registration. Implementation refinement: the pre-check is gated on the same predicate core uses to choose strict decoding (`Tool.getStrictMode(tool) === true`), so only a tool that ends up strict got the pre-check. The pre-check is since retired; core's `errors: "all"` strict decode reports every issue ([successor decision](../decisions/mcp-strict-input-reported-by-core.md)). | `McpServer.ts:1837-1839`, [D: strict default for Claude Code](../decisions/mcp-strict-default-for-claude-code.md) |
| A8 | `McpToolAudit.check` reports a duplicate tool name under **every** policy, independent of `input`/`requireTitle`/etc. | `packages/mcp/src/McpToolAudit.ts:107` |
| A9 | Spec §12 citation fix. The strict decode options are built at `McpServer.ts:1844`; line `:1840` is the dynamic-tool die. The excess-key loop is `SchemaAST.ts:2939-2958`: it stops at the first unexpected key unless `errors: "all"` is set, which core's strict decode now sets. | `.repos/effect/packages/effect/src/ai/McpServer.ts:1844`, `SchemaAST.ts:2939-2958` |
| A10 | `ToolFailure.message` drops any empty part, so an empty hint produces no double space. `truncate` never splits a UTF-16 surrogate pair. | `packages/mcp/src/ToolFailure.ts` |

## Upstream gaps and their kit workarounds

Each gap below was filed on Effect-TS/effect; its status is as read against
the vendored `.repos/effect` and probed against a live stdio server.

- **A strict tool's rejection named only the first unknown key**
  (issue 8495). **Closed upstream** (PR 8508): core decodes every tool's
  parameters with `errors: "all"`, and one `InvalidParams` names every
  excess key at every depth together with every missing or invalid field.
  The kit's unknown-key pre-check, which had answered before core decoded,
  is removed: it hid the missing and invalid fields core now reports
  ([successor decision](../decisions/mcp-strict-input-reported-by-core.md)).
- **A tool whose parameters are a top-level union dies at registration**
  (issue 8496). **Closed as intended** (PR 8507 only makes the error name
  the tool and the object-root requirement, and point at
  `Tool.EmptyParams`). The workaround stays: `McpToolkit.unionTool` /
  `unionHandler`, served through `ToolInputSchema.objectRooted` and decoded
  with `errors: "all"`.
- **A stdin line that is not JSON stopped a stdio server reading**
  (issue 8497), and **a JSON value that is no JSON-RPC message either threw,
  dropping the frames after it in its chunk, or got no reply** (issue 8498).
  **Closed upstream** (PR 8541): core's NDJSON decoder now skips a line
  that does not parse, and its JSON-RPC decoder skips a non-object value and
  no longer throws on a non-string `method`. An over-cap line is dropped
  after core logs `MaxBufferSizeExceeded` on stderr, and the server keeps
  serving. Core still sends **no reply** to any of these lines, where
  JSON-RPC 2.0 requires a `-32700` or `-32600`. The stdin guard stays for
  that reply, not to prevent a wedge.
- **An MCP client can reach core's `@effect/rpc/*` control methods**
  (issue 8499). **Open**; the fix (PR 8509) is unmerged. One line,
  `{"jsonrpc":"2.0","method":"@effect/rpc/Eof"}`, silently stops a server
  that has no guard. The guard answers a request with such a method `-32601`
  and drops such a notification.
- **Two stdio servers in one layer graph share one stdio protocol and one
  tool registry** (issue 8501). **Open**; the fix (PR 8506) is unmerged, and
  the maintainers recommend `Layer.fresh` around each whole bundle. The kit
  documents that recipe on `McpStdio.layer` and mints its guard layer per
  call.
- **A `ping` before `initialize` got an opaque error** (issue 8500).
  **Closed upstream** (PR 8505): the server answers it `{}`. `McpHarness`
  lets `ping` through its pre-`initialize` gate; every other request there
  still fails `NotInitialized`, because the server still refuses it
  opaquely.

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

- [Strict MCP input is reported by core](../decisions/mcp-strict-input-reported-by-core.md), which supersedes
  [D2: strict MCP input is upstream-first](../decisions/mcp-strict-input-upstream-first.md)
- [D10: `McpToolAudit` enforces object-rooted outputs by default](../decisions/mcp-tool-audit-object-rooted-outputs.md)
- [D: strict default for Claude Code](../decisions/mcp-strict-default-for-claude-code.md)
- [`@effected/engine`](engine.md)
- [`@effected/cli`](cli.md)
