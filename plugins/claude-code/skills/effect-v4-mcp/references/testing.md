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
states for `ServerLayer` vs `Main`.

On the default stateful revision (`McpProtocol.v2025_11_25`), `yield*
harness.initialize` first: every other request — `ping` included — fails
`NotInitialized` and is never written, because the server would only answer
an opaque `Invalid request metadata`. `harness.sendRaw` is never gated by
this check; it writes unconditionally. There is no `awaitResponse(id)` on
the harness — use `request` (send and wait) or `startRequest` (send now,
wait later) instead. `strictStdout` (default `true`) dies the wait, rather
than failing it typed, the moment the server writes a stdout line that is
not JSON-RPC — assert that with `Effect.exit` + `Cause.hasDies`, not a typed
failure check. Closing the harness before reading a request's response
drops that response, the same "read first, close second" rule
`server-wiring.md` states for `McpProcess`.

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
unknown-tool counter-case. A test over this matrix needs the real clock:
`McpHarness.make` builds and tears down a layer graph per iteration, so use
`it.live`, not `it.effect` — **not** nested inside `@effect/vitest`'s
`layer(...)` helper, whose returned `it` (`Vitest.MethodsNonLive`) has no
`.live` method at all; only the top-level `it` export does.

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

Passes. **Mutation check:** changing the first revision's expected code from
`-32602` to `-32600` fails by assertion — `expected -32602 to equal -32600`
— confirming the test actually reads the real response code rather than a
constant; restoring `-32602` returns it to green.

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
anything. For the stdin-guard proof over `McpProcess.sendRaw(string |
Uint8Array)` — new from the kit fix that guards `McpStdio.layer`'s stdin —
see `server-wiring.md`'s [Stdin guard](./server-wiring.md#stdin-guard),
which already spawns a real process, sends a genuinely malformed line, and
asserts the server answers a typed `-32700` and keeps serving rather than
wedging.

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
writes nothing to stderr passes that weaker check. On a `StreamEnded`
failure (the child exited before responding), the exit code and stderr are
folded into the failure message, since the caller holds no separate handle
to read them once the streams have ended.

Composed with `PackedInstall.run` (`@effected/workspaces/testing`) in the
consumer's own end-to-end test — this is typecheck-only here: it really
packs each package and installs into a scratch project per available
manager, too heavy for this skill's own gate, and reused verbatim from
`@effected/workspaces`' own README:

~~~ts
// __test__/e2e/packed-install.e2e.test.ts, two levels below the workspace root
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeServices } from "@effect/platform-node"
import { assert, describe, layer } from "@effect/vitest"
import { McpProbe } from "@effected/mcp/testing"
import { Workspaces } from "@effected/workspaces"
import { PackedInstall } from "@effected/workspaces/testing"
import { Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const Live = Workspaces.layer({ cwd: ROOT }).pipe(Layer.provideMerge(NodeServices.layer))

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
            managers: ["npm", "pnpm", "yarn", "bun"],
            bins: ["my-tool-mcp"],
            env: process.env,
            installTimeout: "2 minutes",
          })
          assert.isAbove(result.consumers.length, 0, `nothing installed; unavailable: ${result.unavailable.join(", ")}`)
          const env = PackedInstall.scrubEnv(process.env)
          for (const consumer of result.consumers) {
            const bin = ChildProcess.make(consumer.binPath("my-tool-mcp"), [], {
              cwd: consumer.directory,
              env,
              extendEnv: false,
            })
            const { response, stderr, exitCode } = yield* McpProbe.initialize(bin).pipe(Effect.timeout("30 seconds"))
            assert.isUndefined(response.error, `${consumer.manager}: initialize was refused`)
            assert.strictEqual(stderr, "", `${consumer.manager}: stderr`)
            assert.strictEqual(exitCode, 0, `${consumer.manager}: exit code`)
          }
          // The installs run one after another: the guard covers 4 managers x installTimeout, plus pack and probes.
        }).pipe(Effect.timeout("12 minutes")),
      780_000,
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
`"<tool>: <what>"` strings; empty means the sweep passed.

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
console.log("duplicate names reported under input: any:", McpToolAudit.check([open, duplicate], { input: "any" }))
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
naming the open tool's root as open; one `duplicate tool name` violation
(reported under `input: "any"` too — a duplicate is checked unconditionally,
independent of every other policy field); one violation listing all four
missing hint names; one violation stating the description's length against
the limit; one violation naming the non-object `outputSchema`'s root type;
then `[]` once `objectRootedOutput` is explicitly turned off.

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

An `Effect.timeout` guard of `5` seconds or more, run under vitest's own
`5` second default test timeout, is dead code: vitest kills the test before
the guard ever fires, so the guard's own failure message — the one naming
what actually hung — never has a chance to run. Keep a guard at `3` seconds
(as used throughout this reference), or pass an explicit, larger vitest
timeout (the second argument to `it`/`it.live`, as the packed-install
example above does with `780_000`).
