# @effected/mcp

The boundary layer of an `effect/unstable/ai` MCP server: stdio wiring that
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
wire message; nothing else in `@effected/engine` is consumed yet.

## Exports

`@effected/mcp` (`src/index.ts`): `McpStdio` (`protocols`, `layer`, `launch`,
`teardown`), `McpToolkit` (`layer`), `ToolFailure` (`fields`, `message`,
`truncate`, `ECHO_LIMIT`, `ENGINE_ECHO_LIMIT`), `ToolInputSchema`
(`unknownKeys`, `formatUnknownKeys`, `objectRooted`), plus the
`McpStdioOptions`, `McpToolkitOptions`, `UnknownKeysLevel` and
`FormatUnknownKeysOptions` types.

`@effected/mcp/testing` (`src/testing.ts`): `McpHarness` (`make`),
`McpProcess` (`spawn`; instances carry `send`, `sendRaw`, `nextLine`,
`readUntilResponse`, `handshake`, `closeStdin`, `exitCode`, `stderrSoFar`,
`stderrFinal`), `McpProbe` (`initialize`), `McpTestFailure`,
`McpToolAudit` (`check`), plus the `McpHarnessOptions`, `McpProbeOptions`,
`McpProbeResult`, `McpToolAuditPolicy`, `JsonRpcMessage` and `ServedTool`
types.

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
- **`McpStdio.layer` guards the server's stdin.** Core's stdio decoder
  throws on a line that is not JSON before it drops that line from its
  buffer, so every later chunk throws on it again and the server stops
  answering while stdin EOF still exits 0. `McpStdio.layer` provides the
  server a `Stdio` (`src/internal/StdinFrames.ts`) that frames stdin the
  way core does (streaming UTF-8 decode, BOM stripped only at stream
  start), answers a non-JSON or over-cap (16 Mi code units) line with a
  `-32700` parse error, drops JSON-whitespace lines, and answers JSON that
  is no JSON-RPC message core can handle with a `-32600` Invalid Request:
  a non-object non-array value (core throws on `null`, dropping the rest of
  its chunk, and silently ignores scalars), an object with a non-string
  `method` and no usable `id` (core throws), and an object with neither
  `method` nor `id` (core ignores it). Arrays, responses and requests with
  an `id` go to core, which answers or ignores them correctly itself —
  probe before widening the guard, and keep the `answerFor` classes in step
  with what core actually throws on. Its state lives once per `Stdio`, not
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
  (`CurrentMemoMap.forkOrCreate`). Isolate a server with its own
  `ManagedRuntime`, `Effect.provide(layer, { local: true })` or its own
  process. This is core's behaviour with or without the guard.
  `McpHarness.make` builds with a fresh memo map
  (`Layer.buildWithMemoMap(…, Layer.makeMemoMapUnsafe(), scope)`) for this
  reason, so a harness never shares an ambient server's protocol.
  `Layer.fresh` around `layerStdio` is not a fix: tried, it failed 35 of
  the harness and toolkit tests
  (tool calls stopped resolving), most likely because core's `McpServer.layer`
  is also a shared constant that `McpServer.toolkit` registers through.
- **Code after a completed `Effect.provide` of a stdio server never
  runs.** Core's `makeProtocolStdio` captures the fiber that builds it and
  interrupts that fiber when its stdin loop ends
  (`ensuring(forkDetach(Fiber.interrupt(fiber)))`), which closing the
  provide's scope does. Tests serve a server through `McpHarness`.
- **The harness never hangs.** Every `McpHarness` response wait and
  `awaitOutboundMethod` races a stop signal and a corruption signal, so a
  server that stops before responding, or writes a non-JSON-RPC line under
  `strictStdout`, fails or dies the wait instead of hanging the test.
- **`closeStdin` (`McpProcess`) and `close` (`McpHarness`) both use
  `Queue.end`, never `Queue.shutdown`.** `end` delivers every frame already
  offered before closing; `shutdown` would drop a frame sent immediately
  before close.
- **`McpProbe` holds stdin open until the id-1 response arrives, then
  closes it.** Closing stdin right after writing — every hand-rolled smoke
  test did this — makes an Effect server drop the in-flight response and
  exit 0, reading as a pass with no response.
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
