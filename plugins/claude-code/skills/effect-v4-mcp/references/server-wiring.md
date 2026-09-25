# Server wiring: main.ts, the stdio boundary, protocols and crash guards

Loaded from `effect-v4-mcp`. Covers the complete `main.ts`, why `Stdio` is provided at the edge, `McpStdio`'s three pieces, protocol ordering, crash guards, and resolving a launched project directory.

## The complete `main.ts`

~~~ts
import { McpStdio, McpToolkit, ToolFailure } from "@effected/mcp"
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  ...ToolFailure.fields,
  id: Schema.String,
}) {}

const GetThing = Tool.make("get_thing", {
  description: "Fetch a thing by id.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ name: Schema.String }),
  failure: NotFound,
})

const MyTools = Toolkit.make(GetThing)

const MyHandlers = MyTools.toLayer({
  get_thing: ({ id }) =>
    id === "known"
      ? Effect.succeed({ name: "a known thing" })
      : Effect.fail(
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

const ToolsLayer = McpToolkit.layer(MyTools).pipe(Layer.provide(MyHandlers))
const ServerLayer = ToolsLayer.pipe(Layer.provideMerge(McpStdio.layer({ name: "my-server", version: "1.0.0" })))

// The platform Stdio is the one service provided at the edge.
const Main = ServerLayer.pipe(Layer.provide(NodeStdio.layer))

NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown })
~~~

`ServerLayer` still requires `Stdio`; `Main` supplies `NodeStdio.layer` from
`@effect/platform-node` just before launch, and leaving that line out fails
to typecheck. **Test `ServerLayer`, never `Main`**: `McpHarness.make` builds
its own queue-backed `Stdio`, and a `Stdio` the server already provides
internally would win over the harness's and talk to the real terminal.

## `McpStdio.layer`

`McpStdio.layer(options)` is `McpServer.layerStdio` (`layerStdio`) with
`LogToStderr` **merged** into its own output via `Layer.provideMerge`, then
`Layer.orDie`. Two consequences:

- Every layer composed **with** `McpStdio.layer` inherits the stderr routing.
  A sibling merged in beside it with `Layer.mergeAll` instead of
  `Layer.provideMerge` is not provided *by* it, so that sibling's own build
  still logs through the default logger, which lands on stdout when nothing
  else has set `LogToStderr`.
- A malformed `protocols` list — more than one stateless adapter — is the
  implementer's own defect: `Layer.orDie` turns the `IllegalArgumentError`
  core would otherwise raise into a die, since there is no way to recover
  from a static configuration mistake at runtime. `protocols` is typed
  `NonEmptyReadonlyArray`, so an empty list is a compile error, not a
  runtime one.

**Two stdio servers in one process: wrap each whole server bundle in
`Layer.fresh`.** Core's `RpcServer.layerProtocolStdio` and the tool registry
`McpServer.McpServer.layer` are both module constants, and layers memoize by
reference. So two servers built through one memo map share one stdio
protocol, built over whichever `Stdio` came first, and one tool registry. The
second server never reads its own stdin, and the first lists both servers'
tools. That happens when both are merged into one graph, and also when the
second is built or provided anywhere under the first one's `Effect.provide`,
since a nested `Layer.build` or `Effect.provide` forks the memo map already
in the fiber's context. The stdin guard changes none of this.

`Layer.fresh(layer)` builds `layer` and everything under it through a new
memo map, so each bundle gets its own protocol and its own registry. Wrap
the **whole** bundle — the toolkit layers together with the server, and the
`Stdio` too if it is per server:

~~~ts
const serverA = McpToolkit.layer(ToolkitA).pipe(
  Layer.provide(HandlersA),
  Layer.provideMerge(McpStdio.layer({ name: "a", version: "1.0.0" })),
)
const serverB = McpToolkit.layer(ToolkitB).pipe(
  Layer.provide(HandlersB),
  Layer.provideMerge(McpStdio.layer({ name: "b", version: "1.0.0" })),
)

const Both = Layer.mergeAll(
  Layer.fresh(serverA.pipe(Layer.provide(StdioA))),
  Layer.fresh(serverB.pipe(Layer.provide(StdioB))),
)
~~~

The trap is wrapping **only** `McpStdio.layer` (or `McpServer.layerStdio`)
in `Layer.fresh` and leaving the toolkit outside. The server then answers on
its own stdin but serves **no tools**, even when it is the only server: the
toolkit registers into the registry the outer memo map built, and the server
inside the fresh boundary built a second one nobody registers into. The
boundary goes around the toolkit and the server together, never between
them.

A nested server is separated the same way: build or provide the whole inner
bundle through `Layer.fresh`, or through `Effect.provide(layer, { local: true })`.
Its own `ManagedRuntime` or its own process also works. One server per
process, which is how an MCP client launches a stdio server, needs none of
this.

### Stdin guard

Core's own stdio decoder (`RpcSerialization.makeNdjson`) runs `JSON.parse`
on each line inside its read loop and throws before it trims the consumed
line from its buffer. A line that is not JSON therefore stays at the head of
that buffer forever: every later chunk re-throws on the same line, the
server never answers another request, and stdin EOF still exits `0` — a
silent hang, not a crash. A blank line does the same (`JSON.parse("")`
throws), and so does a U+FEFF opening any line but the first, since core's
streaming decoder strips a byte-order mark only at the very start of the
stream. A line over the 16 Mi-UTF-16-code-unit cap fails differently but no
better: `failMaxBufferSize` clears the buffer before throwing, so the rest of
that line arrives as an unanswered fresh line and the client never gets a
reply either way.

`McpStdio.layer` provides the server a `Stdio` wrapped by an internal
stdin-framing guard that frames stdin exactly as core's decoder does — one streaming UTF-8
decoder, the same BOM-at-stream-start rule, the same 16 Mi-code-unit cap —
and answers every line core would choke on itself, on `stdout`, before core
ever sees it:

- a non-JSON or over-cap line gets `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}`,
  the over-cap case answered once, as soon as the held text passes the cap,
  discarding the rest of that line up to its newline;
- a line of JSON whitespace is dropped, not answered;
- a line that is JSON but no JSON-RPC message core can handle gets
  `{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}}`
  and never reaches core. That is a value that is neither an object nor an
  array (core throws on a bare `null`, dropping every other frame that
  arrived in the same chunk, and ignores a number, string or boolean with no
  reply), an object whose `method` is not a string and whose `id` is absent
  or `null` (core throws on that too), and an object with neither `method`
  nor `id`, which is neither a request nor a response. A request co-batched
  in the same write after such a line is still answered.

Everything else goes to core, which handles it: an array gets core's own
`-32600` (it serves no batches), an object with an `id` and no `method` is a
response and gets no reply, and a request with an `id` is answered even when
its `method` is malformed.

The guard's own state — the held partial line — lives once per `Stdio`, not
per subscription, so it survives core re-subscribing to stdin after any
failure in its read loop. Hand-wiring `McpServer.layerStdio` directly, without
`McpStdio.layer`, skips all of this and wedges on the first bad line.

~~~ts
import { unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { McpProcess } from "@effected/mcp/testing"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

// A minimal server, written to disk so it can be spawned as a real process —
// the guard only matters over a real pipe, not the in-process test harness.
const serverFile = join(import.meta.dirname, "mcp-guard-demo-server.mjs")
writeFileSync(
  serverFile,
  `
import { McpStdio, McpToolkit } from "@effected/mcp"
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

const Ping = Tool.make("ping", { description: "Liveness check.", parameters: Tool.EmptyParams })
const Tools = Toolkit.make(Ping)
const Handlers = Tools.toLayer({ ping: () => Effect.void })
const Main = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "guard-demo", version: "0.0.0" })),
  Layer.provide(NodeStdio.layer),
)

NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown })
`,
)

const program = Effect.gen(function* () {
  const server = yield* McpProcess.spawn(ChildProcess.make(process.execPath, [serverFile]))
  yield* server.handshake()
  // A bad line and a good one, written in the same chunk.
  yield* server.sendRaw('not json\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n')
  const { response, seen } = yield* server.readUntilResponse(2)
  console.log("answered the bad line itself:", seen.some((f) => (f as { id: unknown }).id === null))
  console.log("kept serving after it:", Array.isArray((response.result as { tools: unknown }).tools))
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.timeout("5 seconds"))

await Effect.runPromise(program).finally(() => unlinkSync(serverFile))
~~~

Prints `answered the bad line itself: true` and `kept serving after it:
true` — the malformed line got its own `-32700` reply and the server never
wedged.

## `McpStdio.launch`

A bare `NodeRuntime.runMain(Layer.launch(Main).pipe(Effect.provideService(References.LogToStderr, true)))`
typechecks and serves — and still reports a launch failure on stdout. The
reason is where `runMain`'s own report happens: `Effect.tapCause`, attached
by `runMain` itself, **outside** anything the launched program provided
(`Runtime.ts:207-214`). By the time that cause reaches the tap, the
`provideService` scope around the already-failed effect has closed and
`LogToStderr` is back to its ambient default, so `runMain`'s own
`Effect.logError` call writes through `console.log`.

`McpStdio.launch` fixes this from inside the effect, before `runMain` ever
sees it: it catches the cause, logs it itself while `LogToStderr` is
provided around the whole catch (not just the launched layer), then
re-raises marked `[Runtime.errorReported] = false` — so `runMain`'s later,
out-of-scope tap sees an already-reported failure and stays silent instead
of printing a second, malformed report onto the wire.

## `McpStdio.teardown`

A stdio server's session does not end by the program failing — it ends
because **stdin reaching EOF externally interrupts the main fiber**. A
`catchCause` wrapped around `Layer.launch` never sees this: an interrupt
skips every `catchCause`, so the cause reaches the runtime's own teardown
directly, and the *default* teardown reports `130` for any interrupt-only
cause — the same code as a killed process, for what is actually a clean
client disconnect. `McpStdio.teardown` maps a success or an interrupt-only
exit to `0`; everything else still goes to `Runtime.defaultTeardown`.

`SIGINT` and `SIGTERM` land the same way: `runMain` interrupts the main
fiber on either signal too, so a killed server also produces an
interrupt-only exit and reports `0` under `McpStdio.teardown`, not the
signal's own exit code.

Evidence: the complete `main.ts` snippet above, run with stdin `/dev/null`,
exits `0` with empty stdout — closing stdin immediately reproduces the EOF a
real client's disconnect produces.

Closing stdin while a request is still in flight drops that response
silently, in either direction: `McpProcess.closeStdin` and `McpHarness.close`
are both `Queue.end`, never `Queue.shutdown`, precisely so every frame
already sent is delivered first — but that only protects frames already
*written*, not a response still in flight when stdin ends. Read the
response before closing stdin, both in a hand-rolled test client and in
production usage of a spawned server.

## Protocol ordering

`McpStdio.protocols` is `[McpProtocol.v2026_07_28, v2025_11_25, v2025_06_18]`
— the stateless revision first, then the two newest stateful ones. The order
is load-bearing, not cosmetic, but it decides less than it looks like it
does: a request carrying `_meta` — `server/discover` included — is matched
against whichever adapter in the list recognizes it, in either order. What
the order actually decides is the **fallback** for a request with neither a
session nor `_meta`:

- **Stateless first** (the shipped order) answers that fallback case with
  `-32602 Invalid request metadata` from the stateless adapter.
- **Stateful first** answers it with `-32601` (method not found) for
  `server/discover` and `-32603` (internal error) for `tools/list`, since
  the stateful adapter tries to resolve a session that was never
  established.

Keep the stateless adapter first for the more specific, more diagnosable
error on that fallback path — not because ordering is required for a
`_meta`-carrying `server/discover` to be recognized at all.

- **Never reduce the list to one entry.** `initialize` only matches a
  *stateful* adapter — a stateless-only list refuses every client that opens
  with `initialize` instead of `server/discover`.
- **At most one stateless adapter** in the list; a second one fails the
  layer.

Do not assume every client opens with `initialize`: Claude Code has been
measured opening a stdio server with the stateless `server/discover`
instead. Correct any documentation, comment or test that says "clients send
`initialize` by default" — that claim does not hold for every real client.

## Server identity and instructions

Export the `instructions` string as its own named value so a test can assert
it verbatim rather than re-deriving it. `instructions` is surfaced in both
`initialize` and `server/discover` — write it once for both handshakes.
Capabilities are derived from what is actually registered (the tools and
resources on the server), never hand-declared separately from the
registration that would make them true.

## Crash guards

Node already exits `1` on its own for an uncaught exception or an unhandled
rejection with no listener — the guards below do not buy survival by
themselves, they buy a **custom** handler (a prefix on the message, a
process-specific policy) being in place in time to run before Node's default
behaviour does. That timing is the actual reason for the awkward shape: a
throw during evaluation of the server graph itself — a `Toolkit.make` call
that throws building a schema, a dynamic import that rejects — has to reach
*this* handler, not Node's default one, which only works if the guards are
registered **before** anything that could throw is even imported. A static
`import` at the top of the file runs before any code in the file does,
including a guard registration a few lines down — so the guards have to go
first, and everything that follows has to be a dynamic `import()`.

~~~ts
process.on("uncaughtException", (error) => {
  process.stderr.write(
    `server: uncaught exception: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exit(1)
})
process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    `server: unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`,
  )
  process.exit(1)
})

// Do NOT "tidy" these into static imports at the top of the file: a throw
// during evaluation of the server graph itself must still reach the guards
// above, which only works if nothing here is imported before they run.
const { McpStdio } = await import("@effected/mcp")
const { NodeRuntime, NodeStdio } = await import("@effect/platform-node")
const { Layer } = await import("effect")

const Main = McpStdio.layer({ name: "guarded-server", version: "1.0.0" }).pipe(Layer.provide(NodeStdio.layer))

NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown })
~~~

This skeleton is the **exit-always** policy: any uncaught exception or
unhandled rejection, at any point in the process's life, logs and exits `1`.

The other shipped policy is **survive-once-connected**, and it is not about
whether the server holds session-bound state *worth preserving* — it is
about whether any in-process mutable state *could be left half-written*.
Node's own guidance for `uncaughtException` is "do not resume normal
operation", because arbitrary in-process state may be corrupt; a server that
genuinely holds none — every call is a self-contained transaction against an
external store, nothing shared mutates across calls — can accept that
residual risk once a client is already relying on it, because the
alternative (silent process death mid-session, deregistering every tool from
that client) is strictly worse. Three parts, not one flag:

- **`unhandledRejection` never exits.** Anything reaching this handler
  originated outside a tool-call boundary (every in-flight call's own
  rejection is already caught) and has no caller waiting on it, so logging
  and continuing is safe regardless of connection state.
- **`uncaughtException` exits before the transport connects, and survives
  after.** Set a boolean flag once the whole server layer graph has finished
  building (a small `Layer.effectDiscard` tapped onto `Main` runs strictly
  after it, since `Layer.provide` builds its dependency to completion before
  the dependent) and exit only while that flag is still `false`.
- **Every startup step is awaited.** A rejected top-level `await` — a
  dynamic import that fails to resolve — does not reach `unhandledRejection`
  at all: Node routes it to `uncaughtException`, which still exits because
  the connected flag is `false`, and with no `uncaughtException` listener
  installed Node prints the error and exits `1` by itself. The rejection
  that slips through is one nobody awaits — a startup `import()` or setup
  promise left un-awaited drains to the `unhandledRejection` handler above,
  which never exits, so the process carries on with no server listening and
  exits `0` once its event loop drains. `await` every startup promise (or
  catch it and exit `1` yourself) so a startup failure takes the exiting
  path.

Choose **exit-always** when any in-process mutable state could be left
half-written; choose **survive-once-connected**, with all three parts
above, only when none can.

### `McpGuard.run` packages both policies

`@effected/mcp/guard` ships the skeleton above as `McpGuard.run`. The
entrypoint has no static runtime import, so importing it statically is
safe; it registers both listeners, awaits `load()`, reports a rejected
`load()` as `startup failed` with exit `1`, then launches the returned layer
with `McpStdio.launch` and `McpStdio.teardown`. It owns the connected flag
too: `McpStdio.launch`'s `onReady` runs once the whole layer has built.

~~~ts
import { McpGuard } from "@effected/mcp/guard"

await McpGuard.run({
  label: "guarded-server",
  host: process,
  // survive-once-connected; omit policy for exit-always
  policy: { onUncaught: "exitBeforeConnect", onRejection: "log" },
  load: async () => {
    const { McpStdio } = await import("@effected/mcp")
    const NodeRuntime = await import("@effect/platform-node/NodeRuntime")
    const NodeStdio = await import("@effect/platform-node/NodeStdio")
    const { Layer } = await import("effect")
    const Main = McpStdio.layer({ name: "guarded-server", version: "1.0.0" }).pipe(Layer.provide(NodeStdio.layer))
    return { layer: Main, runMain: NodeRuntime.runMain }
  },
})
~~~

Both policy fields default to `"exit"`. `injectCrashAfterConnect` raises an
exception or rejection on a timer just after the server is serving, for an
end-to-end test of the guards; wire it to an environment variable only the
test sets.

## Project directory

Resolve a project directory once, in `main.ts`, from caller-supplied
`argv`/`env`/`cwd` — never by reading `process` anywhere else in the server.

**`argv` takes positional arguments only, never raw `process.argv.slice(2)`.**
`LaunchContext.projectDir` treats every non-empty `argv` entry as a
candidate, in order, so a flag is a directory to it. A plugin whose
`mcpServers` entry launches the server with `args: ["--stdio",
"${CLAUDE_PROJECT_DIR}"]` hands `main.ts` exactly that list, and an MCP
server has no command parser to strip the flag first:

~~~ts
import { LaunchContext } from "@effected/engine"

// The host launched: node server.js --stdio <project dir>
const args = process.argv.slice(2)
const keys = ["MY_TOOL_PROJECT_DIR", "CLAUDE_PROJECT_DIR"]

// WRONG: raw argv. "--stdio" is a non-empty candidate, so it wins.
const wrong = LaunchContext.projectDir({ argv: args, env: process.env, keys, cwd: process.cwd() })

// RIGHT: positionals only. Every flag is dropped before resolving.
const positionals = args.filter((arg) => !arg.startsWith("-"))
const right = LaunchContext.projectDir({ argv: positionals, env: process.env, keys, cwd: process.cwd() })

console.log(JSON.stringify({ wrong, right }))
~~~

Run as `server.js --stdio /work/project`, this prints
`{"wrong":"--stdio","right":"/work/project"}`: a server wired the wrong
way resolves every tool's paths against a directory named `--stdio`. With no
positional at all (`server.js --stdio`), `right` falls through to the `keys`
in order and then to `cwd`. The filter drops bare flags only — a flag that
takes a value (`--config a.json`) leaves its value behind as a positional.
When the launch arguments carry valued flags, or you do not control them,
pass the directory through an environment variable instead and resolve with
`argv: []` and the env `keys` alone:

~~~ts
import { LaunchContext } from "@effected/engine"

// The agent host left CLAUDE_PROJECT_DIR unsubstituted — a literal
// "${CLAUDE_PROJECT_DIR}" string, not an expanded path.
const env = { CLAUDE_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}" }

const resolved = LaunchContext.projectDir({
  argv: [],
  env,
  keys: ["MY_TOOL_PROJECT_DIR", "CLAUDE_PROJECT_DIR"],
  cwd: process.cwd(),
})

console.log(resolved === process.cwd())
~~~

`LaunchContext.isUnsubstituted` is what makes this safe against an agent
host that leaves a template variable unexpanded: some hosts pass a literal
`${CLAUDE_PROJECT_DIR}` string through unsubstituted in some launch paths,
and `projectDir` treats that literal as unusable — trimmed-empty and
placeholder values are both skipped — falling through to the next `keys`
entry and finally to `cwd`, rather than resolving to the literal string
`"${CLAUDE_PROJECT_DIR}"` as a directory.

## Resources

Resource registration, the `mimeType` trap, and the URI-template `/` limit
have their own reference: [resources.md](./resources.md).
