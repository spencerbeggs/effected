# Server wiring: main.ts, the stdio boundary, protocols and crash guards

Loaded from `effect-v4-mcp`. Covers the complete `main.ts`, why `Stdio` is provided at the edge, `McpStdio`'s three pieces, protocol ordering, crash guards, and resolving a launched project directory.

## The complete `main.ts` {#main-ts}

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
- A malformed `protocols` list — an empty array, or more than one stateless
  adapter — is the implementer's own defect: `Layer.orDie` turns the
  `IllegalArgumentError` core would otherwise raise into a die, since there
  is no way to recover from a static configuration mistake at runtime.

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

Evidence: the `#main-ts` snippet above, run with stdin `/dev/null`, exits `0`
with empty stdout — closing stdin immediately reproduces the EOF a real
client's disconnect produces.

## Protocol ordering {#protocols}

`McpStdio.protocols` is `[McpProtocol.v2026_07_28, v2025_11_25, v2025_06_18]`
— the stateless revision first, then the two newest stateful ones. The order
is load-bearing, not cosmetic:

- **Stateless first.** A request that carries no session and no `_meta`
  falls to `protocols[0]`, so the stateless adapter has to be first for a
  client that never sends `initialize` to be recognized at all.
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

## Crash guards {#crash-guards}

A throw during evaluation of the server graph itself — a `Toolkit.make` call
that throws building a schema, a dynamic import that rejects — must still be
reported, which only works if the process-level guards are registered
**before** anything that could throw is even imported. A static `import` at
the top of the file runs before any code in the file does, including a guard
registration a few lines down — so the guards have to go first, and
everything that follows has to be a dynamic `import()`.

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
The other shipped policy is **survive-once-connected**: set a boolean flag
once the whole server layer graph has finished building (a small
`Layer.effectDiscard` tapped onto `Main` runs strictly after it, since
`Layer.provide` builds its dependency to completion before the dependent),
and make the `uncaughtException` handler exit only when that flag is still
`false` — logging and staying alive once the transport is connected.

Choose **exit-always** when the server reloads its state fresh on every
call and holds nothing worth preserving mid-session — a clean restart loses
nothing, and refusing to guess about a corrupted process is the safer
default. Choose **survive-once-connected** when the server holds long-lived,
session-bound state (an open database transaction, an in-memory session
object) that a hard exit would corrupt or silently drop for a client with no
in-flight caller waiting on the failure — logging and continuing carries
less risk than dying mid-session once the transport is already live.

## Resolving the launched project directory {#project-directory}

Resolve a project directory once, in `main.ts`, from caller-supplied
`argv`/`env`/`cwd` — never by reading `process` anywhere else in the server:

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

`McpServer.resource({ uri, name, description, mimeType, content })` returns
a `Layer`. `content` must be an `Effect` producing a **whole**
`ReadResourceResult` — `{ contents: [{ uri, mimeType, text }] }` — not a bare
string: a bare string loses `mimeType` on the read itself, even though the
declared `mimeType` still appears correctly in `resources/list`. A resource
read failure is `new McpSchema.InternalError({ message })`.

A dynamic resource set (one entry per item in a collection loaded at boot)
is built as `Layer.unwrap(Effect.gen(...))`, loading the collection once and
reduce-merging one `McpServer.resource` layer per item from `Layer.empty`;
on a load failure, `tapError(Effect.logError)` then `orElseSucceed(() =>
Layer.empty)` so the rest of the server — its tools included — still comes
up even when the resource collection itself failed to load. This is also
why resources use one static layer per item rather than a single URI
**template**: a template variable such as `{id}` cannot span a `/`
(core's router is `FindMyWay`, `unstable/ai/McpServer.ts:36`), so an id
containing a slash has no way to reach a templated resource.

Closing stdin while a request is still in flight drops that response
silently — read the response before closing stdin, both in a hand-rolled
test client and in production usage of a spawned server.
