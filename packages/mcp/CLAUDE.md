# @effected/mcp

The boundary layer of an `effect/ai` MCP server: stdio wiring that
keeps stdout the JSON-RPC wire, tool-failure shaping, and strict-input
walkers — plus a `./testing` subpath for driving a built server from a test.
Protocol handling, tool registration and the wire format stay core's; this
package fixes the defaults consumers kept getting wrong.

**Design doc:** `@./okf/modules/mcp.md` — Load when: changing the public
surface, the stdio launch/teardown shape, the tool-failure message contract,
or the strict-input walker. `okf/modules/mcp.md` stays `status: draft` until
the user verifies it.

## Tier: boundary — no exceptions in `src/`

`src/` never reads `process` (the guard is `__test__/boundary.test.ts` over
`SourceBoundary.scan` from `@effected/workspaces/testing`; it skips comments,
strings, template text and regex bodies, so only a code-level reference
counts), never imports `node:` or an `@effect/platform*` package,
and never calls `console.*`. `Console` is reached only through core's
`Console.Console` reference. stdout is the JSON-RPC wire; any unguarded write
to it corrupts the protocol.

**Nothing in the kit may depend on this package except an application.**
`@effected/mcp` never takes a runtime dependency on `@effected/cli` or
`@effected/workspaces` — a CLI boundary and an MCP boundary are siblings,
both front ends, never layers on each other; `@effected/workspaces` is a
devDependency for `SourceBoundary` only, and the boundary test forbids
importing it from `src/`.

## Peers

`@effected/engine` (workspace `^`) and `effect` (`catalog:effect:peers`).
`Remediation` from `@effected/engine` is the shape `ToolFailure` folds into a
wire message, and `ProcessGuard` from `@effected/engine/guard` is the whole
guard half of `McpGuard.run`. The peer floor must include an engine version
that ships `./guard`.

## Exports

`@effected/mcp` (`src/index.ts`): `McpStdio` (`protocols`, `layer`, `launch`,
`teardown`), `McpToolkit` (`layer`), `ToolFailure` (`fields`, `message`,
`truncate`, `ECHO_LIMIT`, `ENGINE_ECHO_LIMIT`), `ToolInputSchema`
(`unknownKeys`, `formatUnknownKeys`, `objectRooted`), `ToolOutputSchema`
(`objectRooted`), `ToolRefusal` (`refuse`), plus the
`McpStdioOptions`, `McpLaunchOptions`, `McpToolkitOptions`, `UnionHandlerOptions`, `UnionTool`,
`UnionToolOptions`, `UnknownKeysLevel` and `FormatUnknownKeysOptions`
types. `McpToolkit` also carries `unionTool` and `unionHandler`.

`@effected/mcp/guard` (`src/guard.ts`): `McpGuard` (`run`, and `parseInjectCrash`, which is `ProcessGuard.parseInjectCrash`), plus the
`McpGuardHost`, `McpGuardPolicy`, `McpGuardedServer` and
`McpGuardRunOptions` types. **Its only static runtime import is
`@effected/engine/guard`, which itself imports nothing**: the guards must
be listening before `effect` or the server graph evaluates. `McpGuard.run`
is `ProcessGuard.run` (listeners, policy, `startup failed`, `injectCrash`,
formatter) with an MCP launch in its `load`: it hands the loaded `format`
to `guard.useFormat` and `guard.markConnected` to `McpStdio.launch`'s
`onReady`. Behaviour belongs in the engine, not here. The server half
lives in `src/internal/guardLaunch.ts` behind a dynamic `import()`;
`entrypoints.test.ts` pins the graph (and walks the installed
`@effected/engine/guard` to zero packages), so a static import added to
`McpGuard.ts` fails it.

`@effected/mcp/testing` (`src/testing.ts`): `McpHarness` (`make`; instances
carry `initialize`, `initializeWith`, `sentSoFar`, `discover`, `listTools`, `listResources`, `callTool`, `readResource`, `request`,
`startRequest`, `notify`, `sendRaw`, `awaitOutboundMethod`, `stderrSoFar`,
`consoleLogSoFar`, `close`, `stop`), `McpProcess` (`spawn`; instances carry `send`,
`sendRaw`, `nextLine`, `readUntilResponse`, `handshake`, `closeStdin`,
`exitCode`, `stderrSoFar`, `stderrUntil`, `stderrFinal`), `McpProbe` (`initialize`),
`McpTestFailure`, `McpToolAudit` (`check`), plus the `McpHarnessOptions`,
`McpProbeOptions`, `McpProbeResult`, `McpProcessStderrUntilOptions`, `McpToolAuditPolicy`, `JsonRpcMessage`,
`ServedTool` and `ServedResource` types.

## Load-bearing decisions

- **`McpStdio.launch` reports a launch failure itself, on stderr, rather
  than trusting `Effect.provideService(References.LogToStderr, true)`
  alone.** `provideService` restores the ambient context the moment its own
  effect exits, and `runMain`'s own report runs via `Effect.tapCause`
  *outside* anything the program provides — so a bare
  `Layer.launch(Main).pipe(Effect.provideService(LogToStderr, true))`
  typechecks and serves, but a launch failure still prints through
  `console.log`, onto the wire. `launch` instead catches the cause, logs it
  on stderr, and re-raises a `LaunchFailed` marked
  `[Runtime.errorReported] = false` so `runMain` never reports it a second
  time, keeping the original exit code via `[Runtime.errorExitCode]`.
- **`McpStdio.layer` MERGES `LogToStderr` into its own output** with
  `Layer.provideMerge`, not `Layer.provide` — so every layer composed WITH
  it logs to stderr too, not only the wiring `McpStdio.layer` builds
  internally.
- **`LogToStderr` does not reach `Logger.consoleJson`, `consoleLogFmt` or
  `consoleStructured`.** All three are `Logger.withConsoleLog(format)`,
  which calls `console.log` unconditionally (vendored
  `packages/effect/src/Logger.ts:265-271`, the three at `:917`, `:942`,
  `:965`); only the default logger and `consolePretty` read the reference
  (`internal/effect.ts:6898` and `:6754`). Under `McpStdio` a server must
  not install them: stdout is the wire. Wrap a formatter in
  `Logger.withConsoleError` instead. `McpHarness.test.ts` pins both sides
  through `consoleLogSoFar`.
- **`McpStdio.layer` guards the server's stdin.** Core's stdio decoder
  skips a line it cannot use and keeps serving (Effect-TS/effect PR #8541),
  but sends no reply, where JSON-RPC 2.0 requires one; an over-cap line is
  logged on stderr and dropped. `McpStdio.layer` provides the
  server a `Stdio` (`src/internal/StdinFrames.ts`) that frames stdin the
  way core does (streaming UTF-8 decode, BOM stripped only at stream
  start), answers a non-JSON or over-cap (16 Mi code units) line with a
  `-32700` parse error, drops JSON-whitespace lines, and answers JSON that
  is no JSON-RPC message core can handle with a `-32600` Invalid Request:
  a non-object non-array value, an object with a non-string `method` and
  no usable `id`, and an object with neither `method` nor `id`. A line
  whose `method` starts with `@effect/rpc/` never reaches core: without an
  `id` core reads it as its own RPC control message, and
  `@effect/rpc/Eof` silently stops the server (Effect-TS/effect#8499); the
  guard drops such a notification and answers such a request `-32601`.
  Remove that branch once #8499 is fixed in the installed `effect` (open
  PR #8509 proposes the fix) and a probe shows an unguarded server
  answering a ping sent after an Eof notification. Arrays (even one wrapping an Eof, probed), responses and
  requests with an `id` go to core, which answers or ignores them
  correctly itself — probe before widening the guard, and keep the
  `answerFor` classes in step with what core actually does. Its state lives once per `Stdio`, not
  per subscription: core re-subscribes to stdin after any failure in its
  read loop, and a held partial line must survive that. The guard layer is minted per
  `McpStdio.layer` call (`makeGuardedStdio()`), never a module constant,
  which layers would memoize and share across servers in one graph.
  Toolkit handlers still see the ambient `Stdio`: the guard is
  `Layer.provide`d to `layerStdio` alone.
- **One `McpStdio.layer` server per layer memo map.** Core's
  `RpcServer.layerProtocolStdio` is a module constant, so two stdio servers
  whose builds share a memo map share one protocol, built over whichever
  `Stdio` came first; the second server never reads its stdin. Merging
  both into one graph shares the map, and so does building or providing
  the second anywhere under the first's `Effect.provide`: nested
  `Layer.build` and `Effect.provide` fork the ambient memo map
  (`CurrentMemoMap.forkOrCreate`). The tool registry is shared the same
  way: core's `McpServer.layer` is a module constant too, and
  `McpServer.toolkit` / `McpToolkit.layer` register into whichever copy
  their memo map holds. Isolate a server by wrapping its **whole bundle**
  (its toolkit layers together with `McpStdio.layer`, plus its `Stdio` if
  that is per server) in `Layer.fresh`: probed, each server then gets its
  own protocol and its own registry, tools included. The trap is a
  `Layer.fresh` boundary **between** a toolkit and `McpStdio.layer`: fresh
  around `McpStdio.layer` alone, with the toolkit outside it, builds a
  second, empty registry, so the server serves no tools even when it is
  the only server. That is what failed 35 of the harness and toolkit tests
  when it was tried (tool calls stopped resolving). Its own
  `ManagedRuntime`, `Effect.provide(layer, { local: true })` or its own
  process isolate a server too. This is core's behaviour with or without
  the guard. `McpHarness.make` builds with a fresh memo map
  (`Layer.buildWithMemoMap(…, Layer.makeMemoMapUnsafe(), scope)`) for this
  reason, so a harness never shares an ambient server's protocol.
- **Code after a completed `Effect.provide` of a stdio server never
  runs.** Core's `makeProtocolStdio` captures the fiber that builds it and
  interrupts that fiber when its stdin loop ends
  (`ensuring(forkDetach(Fiber.interrupt(fiber)))`), which closing the
  provide's scope does. Tests serve a server through `McpHarness`.
- **No harness wait outlives the server.** Every `McpHarness` response wait
  and `awaitOutboundMethod` races a stop signal and a corruption signal, so a
  server that stops before responding, or writes a non-JSON-RPC line under
  `strictStdout`, fails or dies the wait instead of hanging the test. The stop
  signal fires only after the stdout router has routed every line the server
  wrote (`Queue.end(stdout)` then `Fiber.await(router)`): a draining server's
  last responses are written just before it stops, and failing the waits
  first raced them (the drain test caught it).
- **Core's stdio server drains at stdin EOF.** In-flight requests still
  answer, then the server stops and the process exits 0 (pinned against a
  spawned process in `McpStdio.test.ts` and in-process in
  `McpHarness.test.ts`). So `McpHarness.close` (stdin EOF) leaves a request
  that never completes pending forever; `McpHarness.stop` interrupts the
  server fiber instead, failing every wait with `ServerStopped`.
- **`closeStdin` (`McpProcess`) and `close` (`McpHarness`) both use
  `Queue.end`, never `Queue.shutdown`.** `end` delivers every frame already
  offered before closing; `shutdown` would drop a frame sent immediately
  before close.
- **`McpProbe` holds stdin open until the id-1 response arrives, then
  closes it.** Closing stdin right after writing — every hand-rolled smoke
  test did this — proves nothing against a server that stops at EOF without
  answering what is in flight: it drops the in-flight response, exits
  0, and reads as a pass with no response.
- **`McpProcess.handshake` always uses id 1.** A test's own requests should
  start at id 2 or above — the harness does not reserve or check this, so
  reusing id 1 collides with the handshake's own response.
- **Only `additionalProperties: false` closes a node.** `ToolInputSchema`
  and `McpToolAudit` both treat a missing value, `true`, or a schema-valued
  `additionalProperties` (a `Record`'s value schema) as open, matching what
  core itself emits — never the looser "any falsy-ish value closes it"
  reading.
- **`McpToolAudit.check` reports a duplicate tool name under EVERY
  policy.** The duplicate-name check runs unconditionally, independent of
  `input`/`requireTitle`/etc. — a duplicate is a violation on any audit, not
  something a permissive policy exempts.

- **`McpToolkit.layer` appends to core's parameter report, never
  pre-empts it.** Core decodes a strict tool with `errors: "all"`
  (Effect-TS/effect PR #8508), naming every excess, missing and invalid
  field in one `InvalidParams`; a kit pre-check in front of it would hide
  the missing and invalid fields. The `addTool` decorator catches that
  `InvalidParams` as it leaves the registered handler (core's only
  `InvalidParams` there is a parameter failure) and appends one
  `Accepted params at <path>: …` line per payload level with an unknown
  key, walked by `ToolInputSchema.unknownKeys` over the served input
  schema (`keys matching …` for `acceptedPatterns`; `This tool accepts no
  params.` for a zero-parameter root). That list is a consumer contract
  (vitest-agent documents it): an agent fixes the call from the reply
  alone. Only a `unionTool` gets a kit decode (core refuses union roots),
  with the same `errors: "all"` and the same lines. `unknownKeyMessage` on
  both option types is a deprecated no-op, kept for one minor.
- **`McpHarness` lets `ping` through before `initialize`**: a stateful
  server answers it `{}` (Effect-TS/effect PR #8505). Every other request
  still fails `NotInitialized` unsent.
- **A pattern-keyed `Schema.Record` is served with `patternProperties`
  only when its RegExp has the `u` flag** (Effect-TS/effect PR #8482);
  without it the record is served open and `ToolInputSchema.unknownKeys`
  accepts any key there.

See `okf/modules/mcp.md`'s "Spec amendments" table (A1–A10) for the full
list, each amendment against the original design spec.

## `./testing` split

`src/testing.ts` is a separate entrypoint, exported at
`@effected/mcp/testing`, so test tooling never enters a server's runtime
import graph. It carries no boundary exception of its own — reachability
from `src/index.ts` is pinned by a test that asserts the two graphs never
cross.

## Test and build

Tests live in `__test__/`, use `@effect/vitest`, assert with `assert.*` —
never `expect`.

```bash
pnpm vitest run --project @effected/mcp   # this package's tests, from the repo root
pnpm build --filter @effected/mcp         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips
`build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` that
looks exactly like a clean gate.
