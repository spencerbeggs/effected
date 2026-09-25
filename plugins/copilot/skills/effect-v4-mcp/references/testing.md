# Testing: the in-process harness, the protocol matrix, spawned clients, the packed-install proof, and the tool audit

Loaded from `effect-v4-mcp`. Covers `McpHarness` (in-process, queue-backed
`Stdio`), the `InvalidParams` protocol matrix, the declared-failure wire
shape, `McpProcess` (a spawned real bin), `McpProbe` (the smallest
packed-install proof), `McpToolAudit` (a pure sweep over `tools/list`), and
timeout guidance.

## The in-process harness

`McpHarness.make(ServerLayer, options?)` is the default for testing a server
layer: an in-process, queue-backed `Stdio`, no child process and no sockets.
Pass the layer **without** its own `Stdio` — a `Stdio` the server provides
internally wins over the harness's and talks to the real terminal, the same
rule `server-wiring.md`'s [complete `main.ts`](./server-wiring.md) section
states for `ServerLayer` vs `Main`. This bites through a bundled platform
layer, not only a `Stdio` named directly: `@effect/platform-node`'s
`NodeServices.layer` (and any house equivalent bundling the same shape)
brings its own `Stdio` along with `FileSystem`, `Path`,
`ChildProcessSpawner`, `Crypto` and `Terminal`, and that bundled `Stdio`
wins the same way — every harness-backed test then hangs to its timeout,
with no error naming why. Provide the individual layers the server actually
needs instead — `NodeFileSystem.layer`, `NodePath.layer`,
`NodeChildProcessSpawner.layer`, `NodeCrypto.layer`, `NodeTerminal.layer` —
and leave `Stdio` out of the composition entirely; the harness supplies it.

On the default stateful revision (`McpProtocol.v2025_11_25`), `yield*
harness.initialize` first: every other request — `ping` included — fails
`NotInitialized` and is never written, because the server would only answer
an opaque refusal: `-32602 Invalid request metadata` when a stateless adapter
is listed first, as in `McpStdio.protocols`, or `-32603 Internal error` when
only stateful revisions are served. `harness.sendRaw` is never gated by
this check; it writes unconditionally. There is no `awaitResponse(id)` on
the harness — use `request` (send and wait) or `startRequest` (send now,
wait later) instead. `strictStdout` (default `true`) dies the wait, rather
than failing it typed, the moment the server writes a stdout line that is
not JSON-RPC — assert that with `Effect.exit` + `Cause.hasDies`, not a typed
failure check. Closing the harness before reading a request's response
drops that response, the same "read first, close second" rule
`server-wiring.md` states for `McpProcess`.

**Code placed after a completed `Effect.provide` of a stdio server never
runs.** Core's stdio protocol interrupts the fiber that built it once the
server stops, so a hand-written test that provides a server layer directly
and asserts afterward silently skips its own assertions — the test reports
green having checked nothing. Use `McpHarness` instead of hand-wiring
`Effect.provide` around a server in a test.

`McpHarness` builds the server under its own fresh memo map, never the
ambient one, so a harness created inside an ambient `Effect.provide` of
another stdio server still answers on its own `Stdio` — it does not hit the
nesting trap above. **Never pass a server layer that provides a layer the
test also provides and then reads** —
`McpHarness.make(server.pipe(Layer.provide(AppLayer)))` under
`Effect.provide(AppLayer)` builds `AppLayer` twice, so the tools write to
one instance and the test reads the other. Leave the service in the server
layer's requirements and provide it once from the test, or build it once
and pass `Layer.succeed(Tag, value)`.

~~~ts
import { McpStdio, McpToolkit } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { assert, describe, it } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Option, Schema, Stdio, Stream } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

const Ping = Tool.make("ping", { description: "Liveness check.", parameters: Tool.EmptyParams })
const Garble = Tool.make("garble", {
  description: "Writes a stray line to stdout.",
  parameters: Tool.EmptyParams,
  success: Schema.Struct({ ok: Schema.Boolean }),
  dependencies: [Stdio.Stdio],
})
const Tools = Toolkit.make(Ping, Garble)
const Handlers = Tools.toLayer({
  ping: () => Effect.void,
  garble: () =>
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio
      yield* Stream.run(Stream.make("garbage\n"), stdio.stdout())
      return { ok: true }
    }).pipe(Effect.orDie),
})
const ServerLayer = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "harness-behaviour", version: "0.0.0" })),
)

describe("McpHarness behaviour", () => {
  it.effect("a request before initialize fails NotInitialized on a stateful revision, ping included", () =>
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer)
      const exit = yield* Effect.exit(harness.request("ping"))
      assert.isTrue(Exit.isFailure(exit))
      const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none()
      assert.isTrue(Option.isSome(failure) && failure.value.reason === "NotInitialized")
    }),
  )

  it.effect("there is no awaitResponse(id) on the harness — request/startRequest are the API", () =>
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer)
      assert.isUndefined((harness as unknown as { awaitResponse?: unknown }).awaitResponse)
      assert.strictEqual(typeof harness.request, "function")
      assert.strictEqual(typeof harness.startRequest, "function")
    }),
  )

  it.effect("strictStdout dies the wait on a non-JSON-RPC stdout line", () =>
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer)
      yield* harness.initialize
      const exit = yield* Effect.exit(harness.callTool("garble"))
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause))
    }),
  )

  it.effect("read the response before close: closing with a request in flight drops it", () =>
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer)
      yield* harness.initialize
      const { response } = yield* harness.startRequest("ping")
      yield* harness.close
      const exit = yield* Effect.exit(response)
      assert.isTrue(Exit.isFailure(exit))
    }),
  )

  it.effect("reading the response first, then closing, works fine", () =>
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer)
      yield* harness.initialize
      const result = yield* harness.request("ping")
      yield* harness.close
      assert.isUndefined(result.error)
    }),
  )
})
~~~

All five pass. `captureLogs` (default `true`) captures the server's console
so its logs are asserted rather than printed: `stderrSoFar` holds stderr
writes and every log line, `consoleLogSoFar` holds anything that went
through `console.log` — which in a real server is the wire, so asserting it
empty is the check that no stray log line reached stdout.

## The `InvalidParams` protocol matrix

`InvalidParams` moves from a JSON-RPC error to an `isError` tool result only
for a **known** tool's own bad parameters, and only on `2025-11-25` and the
stateless `2026-07-28` — see `tools.md`'s [Failures on the
wire](./tools.md#failures-on-the-wire) for the full rule and the
unknown-tool counter-case. A test over this matrix needs the real clock, not
because building the harness twice needs it — the harness-behaviour tests
above build and tear down a fresh `McpHarness` per test under plain
`it.effect` and pass — but because `it.effect` installs `TestClock`, and the
`Effect.timeout("3 seconds")` guard around this test never fires under a
virtual clock that only advances when something explicitly asks it to. Use
`it.live` instead — **not** nested inside `@effect/vitest`'s `layer(...)`
helper, whose returned `it` (`Vitest.MethodsNonLive`) has no `.live` method
at all; only the top-level `it` export does.

~~~ts
import { McpStdio, McpToolkit } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { McpProtocol, Tool, Toolkit } from "effect/unstable/ai"

const Echo = Tool.make("echo", { description: "Echo text back.", parameters: Schema.Struct({ text: Schema.String }) })
const Tools = Toolkit.make(Echo)
const Handlers = Tools.toLayer({ echo: ({ text }) => Effect.succeed({ text }) })
const ServerLayer = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "matrix-demo", version: "0.0.0" })),
)

describe("InvalidParams protocol matrix", () => {
  it.live(
    "a known tool's bad parameter type is -32602 on 2025-06-18 and an isError result on 2025-11-25",
    () =>
      Effect.gen(function* () {
        const revisions = [
          { protocol: McpProtocol.v2025_06_18, expect: "error" as const },
          { protocol: McpProtocol.v2025_11_25, expect: "isError" as const },
        ]
        for (const { protocol, expect } of revisions) {
          const harness = yield* McpHarness.make(ServerLayer, { protocol })
          yield* harness.initialize
          const response = yield* harness.callTool("echo", { text: 42 })
          if (expect === "error") {
            assert.strictEqual((response.error as { code: number } | undefined)?.code, -32602)
            assert.isUndefined(response.result)
          } else {
            assert.isUndefined(response.error)
            assert.isTrue((response.result as { isError?: boolean }).isError)
          }
        }
      }).pipe(Effect.scoped, Effect.timeout("3 seconds")),
  )
})
~~~

Passes, and the assertions actually discriminate: each revision's branch
checks the field the OTHER revision would fail on (`response.error`'s code
for `2025-06-18`, `response.result`'s `isError` for `2025-11-25`), so a test
that silently degenerated to asserting the same thing on both revisions
would fail rather than passing vacuously.

## Declared-failure assertion

~~~ts
import { McpStdio, McpToolkit, ToolFailure } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { ...ToolFailure.fields, id: Schema.String }) {}

const GetThing = Tool.make("get_thing", {
  description: "Fetch a thing by id.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ name: Schema.String }),
  failure: NotFound,
})

const Tools = Toolkit.make(GetThing)
const Handlers = Tools.toLayer({
  get_thing: ({ id }) =>
    Effect.fail(
      new NotFound({
        id,
        remediation: { hint: "List the ids first.", suggestedTool: "list_things" },
        message: ToolFailure.message(`No thing "${ToolFailure.truncate(id)}".`, {
          hint: "List the ids first.",
          suggestedTool: "list_things",
        }),
      }),
    ),
})

const ServerLayer = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "declared-failure-demo", version: "0.0.0" })),
)

describe("declared failure on the wire", () => {
  it.effect("is isError, has no structuredContent, and names the suggested tool", () =>
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer)
      yield* harness.initialize
      const response = yield* harness.callTool("get_thing", { id: "missing" })
      const result = response.result as {
        isError?: boolean
        structuredContent?: unknown
        content: Array<{ text: string }>
      }
      assert.isTrue(result.isError)
      assert.isUndefined(result.structuredContent)
      assert.include(result.content[0]?.text, "Try list_things.")
    }),
  )
})
~~~

Passes: `isError: true`, `structuredContent` absent, and the text ends in
`Try list_things.` — the remediation's `suggestedTool`, folded in by
`ToolFailure.message` at construction (see `tools.md`'s [Failures on the
wire](./tools.md#failures-on-the-wire)).

## Spawned clients: `McpProcess`

`McpProcess.spawn(command)` drives a **built** bin as a real child process —
for a packed-install proof or anything the in-process harness cannot stand
in for. `readUntilResponse(id)` returns `{ response, seen }`, not just the
response, because a `list_changed` notification or another request's
response can interleave before the one you are waiting for arrives;
`seen` is everything read along the way, in order. `handshake` always uses
id `1`, so a test's own requests start at `2` or above — the harness does
not reserve or check this, so reusing id `1` collides with the handshake's
own response. `closeStdin` is `Queue.end`, never `Queue.shutdown` — the same
guarantee `McpHarness.close` makes: a frame already offered still reaches
the child's stdin. `nextLine` fails typed with `StreamEnded` the moment
stdout ends, instead of hanging, so a child that exits early fails the test
rather than timing it out:

~~~ts
import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { McpProcess } from "@effected/mcp/testing"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

const serverFile = join(import.meta.dirname, "mcp-exit-immediately.mjs")
writeFileSync(serverFile, "process.exit(0)\n")

const program = Effect.gen(function* () {
  const server = yield* McpProcess.spawn(ChildProcess.make(process.execPath, [serverFile]))
  const result = yield* Effect.exit(server.nextLine)
  console.log(JSON.stringify(result))
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.timeout("5 seconds"))

await Effect.runPromise(program).finally(() => unlinkSync(serverFile))
~~~

Prints an `Exit` whose cause carries `{"_tag":"McpTestFailure","reason":"StreamEnded", ...}`
— a typed failure, not a hang, for a child that exits before writing
anything. `McpProcess.sendRaw(text: string | Uint8Array)` writes raw bytes
to the child's stdin with no JSON encoding and no newline added — for a
frame `send` cannot construct, such as a genuinely malformed line. See
`server-wiring.md`'s [Stdin guard](./server-wiring.md#stdin-guard), which
already spawns a real process, sends one, and asserts the server answers a
typed `-32700` and keeps serving rather than wedging. JSON that is no
JSON-RPC message (a bare `null`, `{}`) is answered `-32600` the same way;
send a valid request in the same `sendRaw` write after it to prove a
co-batched frame is still answered.

## Packed install proof

`McpProbe.initialize(command)` is the smallest proof that an installed MCP
bin boots: it sends one `initialize` (or `server/discover` on a stateless
revision) as id `1`, keeps stdin open until that response arrives, closes
it, and collects stdout, stderr and the exit code. Holding stdin open until
the response arrives matters: every hand-rolled smoke test that closed stdin
right after writing made an Effect server drop the in-flight response and
exit `0`, reading a slow or broken boot as a pass with no response at all.

The caller asserts `response.error === undefined`, `stderr === ""` and
`exitCode === 0`. Checking `stderr` and the exit code alone is not enough —
a server that answers the handshake with a JSON-RPC error, exits `0` and
writes nothing to stderr passes that weaker check. Any stdout line that is
not JSON-RPC fails typed with `NotJsonRpc`, naming the line — a server that
logs to stdout corrupts the wire, so the probe fails rather than skipping
the line and reading a corrupted boot as clean. On a `StreamEnded` failure
(the child exited before responding), the exit code and stderr are folded
into the failure message, since the caller holds no separate handle to read
them once the streams have ended.

A child that ignores stdin EOF never exits, and the probe waits for it
forever: wrap `McpProbe.initialize` in `Effect.timeout`, the same way every
runnable example in this reference does.

Composed with `PackedInstall.run` (`@effected/workspaces/testing`) in the
consumer's own end-to-end test — this is typecheck-only here: it really
packs each package and installs into a scratch project per available
manager, too heavy for this skill's own gate, and adapted from
`@effected/workspaces`' own README. `consumer.command(name, args?, options?)`
is the command `runBin` would spawn (the install's scrubbed environment,
the consumer's directory) with stdin left open, which is what the probe
writes `initialize` to:

~~~ts
// __test__/e2e/packed-install.e2e.test.ts, two levels below the workspace root
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeServices } from "@effect/platform-node"
import { assert, describe, layer } from "@effect/vitest"
import { McpProbe } from "@effected/mcp/testing"
import { Workspaces } from "@effected/workspaces"
import { PackedInstall } from "@effected/workspaces/testing"
import { Duration, Effect, Layer } from "effect"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer))

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const
const INSTALL_TIMEOUT = "2 minutes"
// The installs run one after another. timeoutBudget sums the run's own ceilings
// (every manager's probe and install, every package's pack) plus the probe per
// consumer, so a named PackedInstallError fires before this guard does. The
// packages come from PackedInstall.closure: the run's own planner, not a hand count.
const BUDGET = PackedInstall.timeoutBudget({
  managers: MANAGERS,
  installTimeout: INSTALL_TIMEOUT,
  packages: await Effect.runPromise(PackedInstall.closure("my-tool").pipe(Effect.provide(Live))),
  perConsumer: "30 seconds",
})

describe("packed install", () => {
  // The real clock: installs and the probe are real processes.
  layer(Live, { excludeTestServices: true })((it) => {
    it.effect(
      "my-tool's MCP bin boots from a packed install under every available manager",
      () =>
        Effect.gen(function* () {
          const result = yield* PackedInstall.run({
            carrier: "my-tool",
            closure: "auto",
            managers: MANAGERS,
            bins: ["my-tool-mcp"],
            env: process.env,
            installTimeout: INSTALL_TIMEOUT,
          })
          assert.isAbove(result.consumers.length, 0, `nothing installed; unavailable: ${result.unavailable.join(", ")}`)
          for (const consumer of result.consumers) {
            const probe = McpProbe.initialize(consumer.command("my-tool-mcp"))
            const { response, stderr, exitCode } = yield* probe.pipe(Effect.timeout("30 seconds"))
            assert.isUndefined(response.error, `${consumer.manager}: initialize was refused`)
            assert.strictEqual(stderr, "", `${consumer.manager}: stderr`)
            assert.strictEqual(exitCode, 0, `${consumer.manager}: exit code`)
          }
        }).pipe(Effect.timeout(BUDGET)),
      Duration.toMillis(BUDGET) + 60_000,
    )
  })
})
~~~

`layer(...)` from `@effect/vitest` is correct **here** — unlike the protocol
matrix above, this suite genuinely wants a memoized, suite-scoped
`Workspaces` layer shared across its (one) test, and the packed-install work
inside is `it.effect`, not `it.live`: the note in the protocol-matrix
section is about `layer(...)`'s returned `it` never carrying `.live`, not
about avoiding `layer(...)` altogether.

## `McpToolAudit`

`McpToolAudit.check(tools, policy)` is a pure sweep over a served
`tools/list` (`McpHarness.listTools`, not your own schemas — the served
document differs by protocol revision) that returns every violation as
`"<tool>: <what>"` strings; empty means the sweep passed. `input` is
`"open" | "closed" | "any"`: `"closed"` requires `additionalProperties:
false` on every object node, `"open"` requires none of them to have it, and
`"any"` skips the input walk entirely.

`"closed"` (and `"open"`) is only as sound as the walk: it follows
`properties`, `items`, a schema-valued `additionalProperties`,
`prefixItems`, `anyOf`, `oneOf` and `$defs`, and merges an `allOf` member's
`properties` and `additionalProperties: false` onto its node — but it does
**not** visit `patternProperties` values, an `allOf` member's `items` or
`additionalProperties` schema, or an `allOf` nested inside another `allOf`;
a key declared in two `allOf` members is last-write-wins. A hand-authored or
`Tool.dynamic` schema can pass `"closed"` with an open node the walk never
reached. Core-emitted strict schemas close every node, so a strict
`Tool.make` tool is reported faithfully regardless.

~~~ts
import { McpToolAudit } from "@effected/mcp/testing"
import type { ServedTool } from "@effected/mcp/testing"

const closed: ServedTool = {
  name: "closed_tool",
  description: "d",
  inputSchema: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
}
const open: ServedTool = {
  name: "open_tool",
  description: "d",
  inputSchema: { type: "object", properties: { a: { type: "string" } } },
}
const duplicate: ServedTool = { ...open, name: "open_tool" }

console.log("closed-policy on a closed tool:", McpToolAudit.check([closed], { input: "closed" }))
console.log("closed-policy on an open tool:", McpToolAudit.check([open], { input: "closed" }))
console.log("open-policy on an open tool:", McpToolAudit.check([open], { input: "open" }))
console.log("open-policy on a closed tool:", McpToolAudit.check([closed], { input: "open" }))
console.log("duplicate names reported under input: any:", McpToolAudit.check([open, duplicate], { input: "any" }))
console.log(
  "requireTitle with no title:",
  McpToolAudit.check([open], { input: "any", requireTitle: true }),
)
console.log(
  "requireOutputSchema with none served:",
  McpToolAudit.check([open], { input: "any", requireOutputSchema: true }),
)
console.log(
  "requireHints on a tool with no annotations:",
  McpToolAudit.check([open], { input: "any", requireHints: true }),
)
console.log(
  "maxDescription over the limit:",
  McpToolAudit.check([{ ...open, description: "a very long description indeed" }], { input: "any", maxDescription: 5 }),
)
console.log(
  "objectRootedOutput default true, non-object outputSchema flagged:",
  McpToolAudit.check([{ ...open, outputSchema: { type: "string" } }], { input: "any" }),
)
console.log(
  "objectRootedOutput explicitly false, non-object outputSchema allowed:",
  McpToolAudit.check([{ ...open, outputSchema: { type: "string" } }], { input: "any", objectRootedOutput: false }),
)
~~~

Prints, in order: `[]` (the closed tool passes `"closed"`); one violation
naming the open tool's root as open; `[]` (the open tool passes `"open"`);
one violation naming the closed tool's root as closed under `"open"`; one
`duplicate tool name` violation (reported under `input: "any"` too — a
duplicate is checked unconditionally, independent of every other policy
field); one `no title` violation; one `no outputSchema` violation; one
violation listing all four missing hint names; one violation stating the
description's length against the limit; one violation naming the
non-object `outputSchema`'s root type; then `[]` once `objectRootedOutput`
is explicitly turned off.

`objectRootedOutput`'s default of `true` matters because the protocol
revisions disagree on whether a non-object success schema even survives to
`tools/list` at all:

~~~ts
import { McpStdio, McpToolkit } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { McpProtocol, Tool, Toolkit } from "effect/unstable/ai"

const StringOut = Tool.make("string_out", {
  description: "Returns a bare string success value.",
  parameters: Tool.EmptyParams,
  success: Schema.String,
})
const Tools = Toolkit.make(StringOut)
const Handlers = Tools.toLayer({ string_out: () => Effect.succeed("ok") })
const ServerLayer = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "non-object-output-demo", version: "0.0.0" })),
)

const listOn = (protocol: McpProtocol.ProtocolAdapter) =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer, { protocol })
      yield* harness.initialize
      const [tool] = yield* harness.listTools
      return { protocol: protocol.protocolVersion, outputSchema: tool?.outputSchema }
    }),
  )

console.log(await Effect.runPromise(listOn(McpProtocol.v2025_11_25)))
console.log(await Effect.runPromise(listOn(McpProtocol.v2026_07_28)))
~~~

Prints `{ protocol: '2025-11-25', outputSchema: undefined }` then `{
protocol: '2026-07-28', outputSchema: { type: 'string' } }` — the stateful
revision drops a non-object `outputSchema` entirely, and the stateless
`2026-07-28` revision passes it through as-is. `objectRootedOutput`'s
default flags that non-object schema on every revision, catching the design
mistake before it ships rather than only on the revisions that happen to
surface it.

## Timeouts

A `3`-second `Effect.timeout` guard only fires under a real clock: `it.live`
(as the protocol matrix above uses), or `layer(X, { excludeTestServices:
true })`. Written inside plain `it.effect`, the same guard is dead code — it
races `TestClock`, which never advances on its own, so the guard never
fires and the test instead hangs until vitest's own `5`-second default test
timeout kills it, reporting a generic timeout with none of the guard's own
diagnostic message.

A second, distinct cause produces the same symptom: an `Effect.timeout`
guard of `5` seconds or more, run under a real clock and under vitest's own
`5` second default test timeout, is dead code because the two race at the
same real duration and vitest's own timeout wins — the guard never fires,
so its own failure message — the one naming what actually hung — never has
a chance to run. Keep a guard at `3` seconds (as
used throughout this reference), or pass an explicit, larger vitest timeout
(the third argument to `it`/`it.live`, after the name and the test body, as the packed-install example above
does with `Duration.toMillis(BUDGET) + 60_000`).
