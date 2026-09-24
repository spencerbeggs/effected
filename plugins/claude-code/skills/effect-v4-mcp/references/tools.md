# Tools: definition, strict input, failures, and the ok-false envelope

Loaded from `effect-v4-mcp`. Covers `Tool.make`, annotations, `Toolkit.toLayer`, strict-input reporting, what reaches the agent on failure, and the `ok: false` envelope recipe.

## Defining a tool

`Tool.make(name, { description, parameters, success, failure, dependencies })`
is the whole shape. `dependencies` is required the moment a handler yields a
service: omit it and `Tool.HandlerServices` infers `never` for that tool, so
the toolkit's `toLayer` call fails to typecheck against a handler that
actually needs something.

A tool with **no** parameters uses `Tool.EmptyParams`, never a zero-key
`Schema.Struct({})`:

~~~ts
import { Tool } from "effect/unstable/ai"

// RIGHT — Tool.make already defaults an omitted `parameters` to this.
Tool.make("ping", { description: "Liveness check.", parameters: Tool.EmptyParams })
~~~

`Schema.Struct({})` is not an equivalent stand-in. Registering a tool with
it dies the server layer at build time — before any client ever calls it —
with `SchemaError(Missing key at ["type"])`: `McpServer`'s own registration
path decodes the JSON Schema it generates for a tool's parameters against a
fixed shape (`ToolJson`), `.orDie` on failure, and a zero-key struct produces
a shape that decode rejects (`unstable/ai/McpServer.ts:1864-1866`, the same
`orDie` that kills the server on a top-level union parameter — see
[Failures on the wire](#failures-on-the-wire)). This is a **registration-time defect**, not a
runtime rejection by a client's own schema validator — the server never
finishes coming up.

Annotate hints onto a tool with `.annotate`, one call per hint:
`Tool.Title` (a `Context.Service` class, `unstable/ai/Tool.ts:1733`),
`Tool.Readonly`, `Tool.Destructive`, `Tool.Idempotent`, `Tool.OpenWorld`
(`Context.Reference`s, `:1776`, `:1802`, `:1829`, `:1856`). Each maps
directly to an MCP hint (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, `openWorldHint`); an unannotated tool defaults to the
*less* trusting reading in every case (`Readonly` and `Idempotent` default
`false`; `Destructive` and `OpenWorld` default `true`).

`Toolkit.make(...tools)` collects tool *definitions*; `toolkit.toLayer(handlers)`
is the one place a definition meets its actual implementation, keyed by tool
name. Keep handlers thin — parse and shape the call, then hand off to the
engine that does the real work; a handler that grows business logic of its
own is the tool boundary blurring into the engine it should be calling.

## Strict input

A tool annotated `Tool.Strict` true is served with `additionalProperties:
false` on every object node and decoded with `onExcessProperty: "error"`
(`unstable/ai/McpServer.ts:1835`) — but core's decode reports only the
**first** excess key it finds, so an agent fixes one typo and never learns
about a second one, nested or not, until the next round trip.

`McpToolkit.layer` runs core's own `registerToolkit` unchanged, under a
registration-scoped `McpServer` whose `addTool` puts an unknown-key
pre-check in front of every strict tool's handler — **before** core ever
decodes. It is the better *report*, not the rejecter: rejection is still
core's `Tool.Strict` decode; the pre-check just names every unknown key
path, at every depth, in one response.

~~~ts
import { McpStdio, McpToolkit } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

const SaveThing = Tool.make("save_thing", {
  description: "Save a thing.",
  parameters: Schema.Struct({
    name: Schema.String,
    nested: Schema.Struct({ value: Schema.String }),
  }),
  success: Schema.Void,
})

const Tools = Toolkit.make(SaveThing)
const Handlers = Tools.toLayer({ save_thing: () => Effect.void })
const ServerLayer = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "probe", version: "0.0.0" })),
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* McpHarness.make(ServerLayer)
    yield* client.initialize
    const call = yield* client.callTool("save_thing", {
      name: "x",
      extra: 1,
      nested: { value: "y", bogus: 2 },
    })
    console.log(JSON.stringify(call.result))
  }),
)

Effect.runPromise(program)
~~~

Prints an `isError: true` result naming **both** unknown keys — the
top-level `extra` and the nested `nested.bogus` — each with its own accepted
list: `Unrecognized parameter(s): extra. Accepted params: name, nested.
Unrecognized parameter(s): nested.bogus. Accepted params: value.`

`McpToolkit.layer`'s `strict` option defaults to `"all"`: every tool without
its own `Tool.Strict` annotation is re-annotated strict and decoded that
way. This default is safe against real traffic — Claude Code sends a tool
call's `arguments` with exactly the tool's declared keys and keeps every
protocol extra (client info, capabilities, its own tool-use id, the progress
token) under the sibling `params._meta`, never inside `arguments` — so
strict-by-default rejects nothing a real call actually sends. An explicit
annotation, `true` or `false`, always wins over the default in either mode,
and a `Tool.dynamic` tool is never re-annotated: core dies at registration
on a strict dynamic tool, because it cannot strictly validate a raw JSON
Schema the way it can an `Effect Schema`.

`ToolInputSchema.unknownKeys`/`formatUnknownKeys` are for a **`Tool.dynamic`**
tool's own handler only — core decodes a `Tool.make` tool's payload
*before* the handler ever runs (`unstable/ai/McpServer.ts:1888`), so by the
time a `Tool.make` handler executes, an excess key has already been dropped
or rejected; there is nothing left for the handler to check. A `Tool.dynamic`
tool's raw JSON Schema is never decoded that way, so its handler is the only
place left to check it — usually against the same schema rewritten with
`ToolInputSchema.objectRooted`, since a dynamic tool with a raw top-level
union needs that rewrite for the same registration-time reason a
`Schema.Union` parameter does (see [Failures on the wire](#failures-on-the-wire)).

## Failures on the wire

A tool call's result on success carries **both** shapes: `structuredContent`
is the encoded success value, and `content[0].text` is that same value
JSON-stringified — an agent that only reads `content` still gets the data.

A **declared** failure is different, and this is the fact `ToolFailure`
exists to work around: when the failure is an `Error` instance — every
`Schema.TaggedError` is — core sends `isError: true` with `error.message` as
the **only** text, and no `structuredContent` at all
(`unstable/ai/McpServer.ts:1842-1845`). Whatever is not folded into
`message` when the error is constructed never reaches the agent:

~~~ts
import { McpStdio, McpToolkit, ToolFailure } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { ...ToolFailure.fields, id: Schema.String }) {}

const GetThing = Tool.make("get_thing", {
  description: "Fetch a thing by id.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ name: Schema.String }),
  failure: NotFound,
})

const MyTools = Toolkit.make(GetThing)
const MyHandlers = MyTools.toLayer({
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

const ServerLayer = McpToolkit.layer(MyTools).pipe(
  Layer.provide(MyHandlers),
  Layer.provideMerge(McpStdio.layer({ name: "probe", version: "0.0.0" })),
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* McpHarness.make(ServerLayer)
    yield* client.initialize
    const call = yield* client.callTool("get_thing", { id: "missing" })
    console.log(JSON.stringify(call.result))
  }),
)

Effect.runPromise(program)
~~~

Prints `{"content":[{"type":"text","text":"No thing \"missing\". List the
ids first. Try list_things."}],"isError":true}` — no `structuredContent`,
and the remediation only reached the agent because `ToolFailure.message`
folded it into the text at construction. `ToolFailure.fields` (`{ message,
remediation }`) spreads into the `Schema.TaggedError`; `ToolFailure.truncate`
is `truncate(value, limit?)`: it caps at `ECHO_LIMIT` (200 UTF-16 code
units) by default, never splitting a UTF-16 surrogate pair. Pass
`ENGINE_ECHO_LIMIT` (2000) explicitly as `limit` for a value the engine
itself produced, such as a path — the wider cap is not automatic, and a call
that omits it gets `ECHO_LIMIT` regardless of where the value came from.

`InvalidParams` (a parameter-validation failure) differs by protocol
revision, but only for a **known** tool's parameters: on `2024-11-05`,
`2025-03-26` and `2025-06-18` it is a JSON-RPC error, code `-32602`; on
`2025-11-25` and the stateless `2026-07-28` it is an `isError: true` tool
result instead. An unknown tool name, or `arguments` that is not an object at
all, stays a JSON-RPC `-32602` error on every revision — that path never
reaches a tool's own parameter validation, so the later revisions have
nothing to move to `isError`. A test that checks only one of these shapes,
or asserts the newer revisions' `isError` move for every kind of invalid
call rather than only a known tool's bad parameters, misses the other half
of the matrix.

~~~ts
import { McpStdio, McpToolkit } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { McpProtocol, Tool, Toolkit } from "effect/unstable/ai"

const Echo = Tool.make("echo", { description: "Echo text back.", parameters: Schema.Struct({ text: Schema.String }) })
const Tools = Toolkit.make(Echo)
const Handlers = Tools.toLayer({ echo: ({ text }) => Effect.succeed({ text }) })
const ServerLayer = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "invalid-params-demo", version: "0.0.0" })),
)

const runOn = (protocol: McpProtocol.ProtocolAdapter) =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* McpHarness.make(ServerLayer, { protocol })
      yield* harness.initialize
      // A known tool ("echo") called with the wrong parameter type.
      const badParams = yield* harness.callTool("echo", { text: 42 })
      // An unknown tool name, on the same revision.
      const unknownTool = yield* harness.callTool("no_such_tool", { text: "x" })
      return {
        protocol: protocol.protocolVersion,
        badParams: badParams.error !== undefined ? `error ${(badParams.error as { code: number }).code}` : "isError",
        unknownTool:
          unknownTool.error !== undefined ? `error ${(unknownTool.error as { code: number }).code}` : "isError",
      }
    }),
  )

console.log(await Effect.runPromise(runOn(McpProtocol.v2025_06_18)))
console.log(await Effect.runPromise(runOn(McpProtocol.v2025_11_25)))
~~~

Prints `{ protocol: '2025-06-18', badParams: 'error -32602', unknownTool:
'error -32602' }` then `{ protocol: '2025-11-25', badParams: 'isError',
unknownTool: 'error -32602' }` — only `badParams` moves between revisions;
`unknownTool` stays a JSON-RPC error on both.

An **undeclared** failure or a defect is logged on the server's own side and
the client receives a scrubbed, generic internal-error text — deliberately
not the real message, since an unclassified failure might carry anything.

A top-level `Schema.Union` `parameters` schema dies the server at
**registration**, the same way `Schema.Struct({})` does: `Tool.make`'s
`parameters` has to resolve to an object schema for MCP's tool-JSON
encoding, and the registration path's `orDie` decode
(`unstable/ai/McpServer.ts:1864-1866`) kills the server layer while it is
still building — a stdio server never even starts reading stdin, and a
server exposed some other way never finishes coming up either. Design the
tool with an object-rooted, field-discriminated shape from the start; for a
`Tool.dynamic` tool whose raw JSON Schema is a union, rewrite it with
`ToolInputSchema.objectRooted` before registering.

## The `ok: false` envelope

When an agent needs **structured** remediation for an error it should
handle programmatically — not just read as a sentence — put the expected
domain errors inside the tool's own **success** schema instead of its
declared failure channel. Root that schema in an object, not a top-level
`Schema.Union`: unlike [Failures on the wire](#failures-on-the-wire)'s
`Schema.Struct({})` and top-level-union `parameters` cases, which kill the
server at **registration**, a union success root is not a registration-time
defect — the `outputSchema` is simply **silently omitted** from
`tools/list`, and the server keeps serving. An `ok: Schema.Boolean` field
with optional `value`/`error` fields keeps one object root while still
discriminating, at the cost of giving up discriminated typing on the
result — a consumer narrows on `ok` at runtime rather than the type system
narrowing a tagged union for them:

~~~ts
import { Remediation } from "@effected/engine"
import { McpStdio, McpToolkit } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}

const Envelope = Schema.Struct({
  ok: Schema.Boolean,
  value: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  error: Schema.optionalKey(
    Schema.Struct({ _tag: Schema.Literal("NotFound"), message: Schema.String, remediation: Remediation }),
  ),
})

const Lookup = Tool.make("lookup", {
  description: "Look up a thing by id.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: Envelope,
})

const lookup = (id: string): Effect.Effect<{ readonly name: string }, NotFound> =>
  id === "known" ? Effect.succeed({ name: "a known thing" }) : Effect.fail(new NotFound({ id }))

const Tools = Toolkit.make(Lookup)
const Handlers = Tools.toLayer({
  lookup: ({ id }) =>
    lookup(id).pipe(
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catchTag("NotFound", (error) =>
        Effect.succeed({
          ok: false as const,
          error: {
            _tag: "NotFound" as const,
            message: `No thing "${error.id}".`,
            remediation: { hint: "List the ids first.", suggestedTool: "list_things" },
          },
        }),
      ),
    ),
})

const ServerLayer = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "envelope-demo", version: "0.0.0" })),
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const harness = yield* McpHarness.make(ServerLayer)
    yield* harness.initialize
    const [served] = yield* harness.listTools
    console.log("outputSchema present:", served?.outputSchema !== undefined)
    const call = yield* harness.callTool("lookup", { id: "missing" })
    console.log(JSON.stringify(call.result))
  }),
)

await Effect.runPromise(program)
~~~

Prints `outputSchema present: true`, then a result whose
`structuredContent` is the whole `{"ok":false,"error":{...}}` envelope,
`Remediation`'s own `hint`/`suggestedTool` fields included, and `isError`
`false` — the failure never left the success channel, so it is data the
agent can branch on, not text it has to parse. `Effect.catchTag` (or
`Effect.catchTags` for more than one expected error) turns each expected
domain error into that success value. `Remediation` (`@effected/engine`) is
the same shape `ToolFailure` folds into a declared failure's message — reuse
it here instead of a hand-rolled `remediation: Schema.String`, since an
agent reading `structuredContent` benefits from the same `suggestedTool`/
`suggestedArgs` structure either channel would otherwise duplicate. The
trade-off: the success schema now has to describe both the "ok true" and
"ok false" shapes, and grows with every domain error a caller is expected to
handle programmatically. Keep genuinely unexpected failures — the ones no
caller should special-case — as `Error`-instance declared failures instead
of folding everything into this envelope; that keeps its growth
proportional to what an agent actually needs to branch on.
