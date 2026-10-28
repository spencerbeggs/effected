# Tools: definition, strict input, failures, envelopes, replay and capture

Loaded from `effect-v4-mcp`. Covers `Tool.make`, annotations, `Toolkit.toLayer`, strict-input reporting, what reaches the agent on failure, the `ok: false` envelope (`ToolOutcome`), idempotent replay (`ToolReplay`), and keeping an in-process library's output off the wire (`StdioCapture`).

## Defining a tool

`Tool.make(name, { description, parameters, success, failure, dependencies })`
is the whole shape. `dependencies` is required the moment a handler yields a
service: omit it and `Tool.HandlerServices` infers `never` for that tool, so
the toolkit's `toLayer` call fails to typecheck against a handler that
actually needs something.

A tool with **no** parameters uses `Tool.EmptyParams`, never a zero-key
`Schema.Struct({})`:

~~~ts
import { Tool } from "effect/ai"

// RIGHT — Tool.make already defaults an omitted `parameters` to this.
Tool.make("ping", { description: "Liveness check.", parameters: Tool.EmptyParams })
~~~

`Schema.Struct({})` is not an equivalent stand-in. Registering a tool with
it dies the server layer at build time — before any client ever calls it —
with `McpServer cannot register tool '…': its parameters must encode to a
JSON Schema with an object root (type: "object"), such as a Schema.Struct.
Use Tool.EmptyParams for a tool without parameters.`, followed by
`Missing key at ["type"]`: `McpServer`'s own registration path decodes the
JSON Schema it generates for a tool's parameters against a fixed shape
(`ToolJson`) and dies on failure, and a zero-key struct produces a shape
that decode rejects (`ai/McpServer.ts:2118-2131`, the same die that kills
the server on a top-level union parameter — see
[Failures on the wire](#failures-on-the-wire)). This is a **registration-time defect**, not a
runtime rejection by a client's own schema validator — the server never
finishes coming up.

Annotate hints onto a tool with `.annotate`, one call per hint:
`Tool.Title` (a `Context.Service` class, `ai/Tool.ts:1829`),
`Tool.Readonly`, `Tool.Destructive`, `Tool.Idempotent`, `Tool.OpenWorld`
(`Context.Reference`s, `:1874`, `:1901`, `:1929`, `:1957`). Each maps
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
and `errors: "all"` (`ai/McpServer.ts:2086-2089`). Core's report is
complete: one `InvalidParams` names every excess key at every depth
together with every missing or invalid field, so an agent fixes the whole
call in one round trip.

`McpToolkit.layer` runs core's own `registerToolkit` unchanged. Rejection
and the report are both core's. The layer appends to that report, never in
place of it: for each object level of the payload that carries an unknown
key, one line naming what that level accepts —
`Accepted params at the root: name, nested.` or
`Accepted params at ["nested"]: value.`, the path written as core writes
it, `keys matching <pattern>` for keys a `patternProperties` level
accepts, and `This tool accepts no params.` for a zero-parameter tool — so
an agent can fix the call from the reply alone. A failure with no unknown
key is core's report unchanged. Beyond that the layer adds policy:
strict-by-default (below) and the union decode for a
`McpToolkit.unionTool`. Its `unknownKeyMessage` option is deprecated and
ignored; the appended lines are fixed text.

~~~ts
import { McpStdio, McpToolkit } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"

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
    // `name` missing, `extra` and `nested.bogus` unknown.
    const call = yield* client.callTool("save_thing", {
      extra: 1,
      nested: { value: "y", bogus: 2 },
    })
    console.log(JSON.stringify(call.result))
  }),
)

Effect.runPromise(program)
~~~

Prints, on the default `2025-11-25` revision, an `isError: true` result
whose one text names all three problems, one block per issue:
`Invalid parameters for tool 'save_thing': Expected no excess property at
["extra"]`, `Missing key at ["name"]`, `Expected no excess property at
["nested"]["bogus"]` (each block is its message, a newline, and an indented
`at [...]` path), then the two lines the layer appends,
`Accepted params at the root: name, nested.` and
`Accepted params at ["nested"]: value.` The reply follows the same per-revision split as any
other `InvalidParams` (see [Failures on the wire](#failures-on-the-wire)):
on `2024-11-05`, `2025-03-26` and `2025-06-18` this same call gets a
JSON-RPC error, code `-32602`, carrying the same text as its `message`,
not `isError`.

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

Moving a toolkit from core's `McpServer.toolkit` to `McpToolkit.layer` is a
**client-visible wire change**, not a purely internal swap: every
unannotated tool's served `inputSchema` flips from open to
`additionalProperties: false`, because `McpToolkit.layer`'s `strict`
default re-annotates it. If a test pins the served schema's
`additionalProperties`, it flips with the migration.

`ToolInputSchema.unknownKeys`/`formatUnknownKeys` are for a **`Tool.dynamic`**
tool's own handler only — core decodes a `Tool.make` tool's payload
*before* the handler ever runs (`ai/McpServer.ts:2152`), so by the
time a `Tool.make` handler executes, an excess key has already been dropped
or rejected; there is nothing left for the handler to check. A `Tool.dynamic`
tool's raw JSON Schema is never decoded that way, so its handler is the only
place left to check it — usually against the same schema rewritten with
`ToolInputSchema.objectRooted`, since a dynamic tool with a raw top-level
union needs that rewrite for the same registration-time reason a
`Schema.Union` parameter does (see [Failures on the wire](#failures-on-the-wire)).
`unknownKeys` returns one level per object node with an unknown key:
`path`, `unknown`, `accepted`, and `acceptedPatterns` when the node also
accepts keys through `patternProperties`. `formatUnknownKeys` renders a
level as `Unrecognized parameter(s): env.lower. Accepted keys matching:
^X_[A-Z]+$.` in that case, with `Accepted params: …` before it when the
node also declares named keys, and never claims `Accepted params: (none).`
for a node that accepts keys by pattern.

A pattern-keyed `Schema.Record` is served with `patternProperties` (and
`additionalProperties: false` when strict) only when the key pattern's
RegExp has the `u` flag: `Schema.isPattern(/^X_[A-Z]+$/u)`. Without the
flag Effect cannot export the pattern, so the record is served **open** —
`propertyNames: { type: "string" }` beside a schema-valued
`additionalProperties` — while core's strict decode still rejects a key
that misses the pattern. The advertised schema then promises more than the
server accepts. `McpToolAudit.check` with `input: "closed"` reports such a
node as open and names the `u` flag as the fix.

## Failures on the wire

A tool call's result on success carries **both** shapes when the success
value is an object: `structuredContent` is the encoded value, and
`content[0].text` is that same value JSON-stringified — an agent that only
reads `content` still gets the data. A **string** success value
(`success: Schema.String`) is shaped per revision: on `2025-06-18` and
`2025-11-25` the result has no `structuredContent` and `content[0].text`
is the string itself, raw, not JSON-quoted; on the stateless `2026-07-28`
it carries `structuredContent: "<the string>"` and a JSON-quoted
`content[0].text`. Markdown returned as a string therefore reaches a
`content`-reading client verbatim on the stateful revisions.

A **declared** failure is different, and this is the fact `ToolFailure`
exists to work around: when the failure is an `Error` instance — every
`Schema.TaggedError` is — core sends `isError: true` with `error.message` as
the **only** text, and no `structuredContent` at all
(`ai/McpServer.ts:2096-2100`). Only a failure whose `message` is empty, or
that is no `Error` instance, is sent as its JSON-encoded value instead.
Whatever is not folded into `message` when the error is constructed never
reaches the agent:

~~~ts
import { McpStdio, McpToolkit, ToolFailure } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"

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

`failureMode: "return"` does not get structured data through either. Core's
`registerToolkit` builds every failed call's result with `structuredContent`
unset and no `_meta` (`ai/McpServer.ts`, the `CallToolResult` built in
`registerToolkit`'s `handle`), on every revision; under `"return"` the
whole encoded failure is JSON-stringified into `content[0].text` instead —
`{"_tag":"NotFound","message":"…","remediation":{…},"id":"missing"}` — so
the human sentence is buried in JSON a client must parse. That is why
`ToolRefusal.refuse` takes no data argument: put a valid-names list, a
searched root or a missing id in the message, or, when an agent must branch
on the data itself, return the [`ok: false` envelope](#the-ok-false-envelope)
on the success channel, where `structuredContent` does arrive.

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
import { McpProtocol, Tool, Toolkit } from "effect/ai"

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
encoding, and the registration path's decode
(`ai/McpServer.ts:2118-2131`) dies with a message naming the tool and
the object-root requirement, killing the server layer while it is still
building — a stdio server never even starts reading stdin, and a
server exposed some other way never finishes coming up either. Design the
tool with an object-rooted, field-discriminated shape from the start, or
make it with `McpToolkit.unionTool` and write its handler with
`McpToolkit.unionHandler`: the tool is a `Tool.dynamic` served with the
union's strict, object-rooted JSON Schema, and under `McpToolkit.layer` a
bad call is rejected exactly as a `Tool.make` decode failure is (`-32602` on
`2025-06-18`, `isError` later). The union is decoded with the options core
uses for a strict `Tool.make` tool (`onExcessProperty: "error"`,
`errors: "all"`): the discriminant picks the member, and one
`InvalidParams`, worded as core words a `Tool.make` failure, names every
excess, missing and invalid field of that member, followed by the same
`Accepted params at <path>: …` lines. `unionHandler` runs the
same decode itself, so a handler called directly from a test, or
registered through core's `McpServer.toolkit`, fails with the identical
message (a declared `isError` there). Its `unknownKeyMessage` option is
deprecated and ignored. For a hand-written `Tool.dynamic` whose raw
JSON Schema is a union, rewrite it with `ToolInputSchema.objectRooted`
before registering.

## The `ok: false` envelope

When an agent needs **structured** remediation for an error it should
handle programmatically — not just read as a sentence — return the expected
domain error on the tool's **success** channel, where `structuredContent`
does arrive, instead of its declared failure channel. `ToolOutcome`
(`@effected/mcp`) builds that envelope. `ToolRefusal` stays the declared
failure for a call that was itself wrong; both carry `ToolFailure.fields`
(`message`, `remediation`), so an error can move between channels without
reshaping.

~~~ts
import { McpStdio, McpToolkit, ToolOutcome } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { id: Schema.String }) {}

const Lookup = Tool.make("lookup", {
  description: "Look up a thing by id.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: ToolOutcome.envelope(
    Schema.Struct({ ...ToolOutcome.ok, name: Schema.String }),
    [ToolOutcome.error("NotFound", { id: Schema.String })],
    { identifier: "LookupFailure" },
  ),
})

const lookup = (id: string): Effect.Effect<{ readonly name: string }, NotFound> =>
  id === "known" ? Effect.succeed({ name: "a known thing" }) : Effect.fail(new NotFound({ id }))

const Tools = Toolkit.make(Lookup)
const Handlers = Tools.toLayer({
  lookup: ({ id }) =>
    lookup(id).pipe(
      Effect.map(({ name }) => ({ ok: true as const, name })),
      ToolOutcome.catchAsEnvelope({
        NotFound: (error) => ({
          id: error.id,
          message: `No thing "${error.id}".`,
          remediation: { hint: "List the ids first.", suggestedTool: "list_things" },
        }),
      }),
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
    const call = yield* harness.callTool("lookup", { id: "missing" })
    console.log(JSON.stringify(call.result))
  }),
)

await Effect.runPromise(program)
~~~

Prints a result with `isError: false` and `structuredContent`
`{"ok":false,"error":{"_tag":"NotFound","message":"No thing \"missing\".","remediation":{"hint":"List the ids first.","suggestedTool":"list_things"},"id":"missing"}}`,
the same object JSON-stringified in `content[0].text`. The failure never left
the success channel, so it is data the agent branches on, not text it parses.

- **`ToolOutcome.envelope(success, errors, options?)`** is
  `Union([success, { ok: false, error: Union(errors) }])`, object-rooted with
  `ToolOutputSchema.objectRooted` so the `outputSchema` is served on every
  revision — a bare top-level union success is silently left out of
  `tools/list`. Spread `ToolOutcome.ok` into each success member so a client
  can discriminate on `ok`. For a hand-built union success, apply
  `ToolOutputSchema.objectRooted` yourself — only when every member is an
  object shape, since its added `type: "object"` is an unchecked claim about
  each member.
- **`ToolOutcome.error(tag, fields?)`** is one error's schema: `_tag`,
  `message`, `remediation` (engine's `Remediation`), and your fields. A field
  named `_tag`, `message` or `remediation` is a type error.
- **Envelope options.** By default the failure member is inlined and carries
  the description "An expected error the caller should branch on, returned in
  place of a result." (its `ok` and `error` carry their own default
  descriptions). `identifier` names it, so it is emitted once under `$defs`
  and the `anyOf` refers to it by `$ref` (`#/$defs/LookupFailure` above);
  `description` replaces the default text.
- **`catchAsEnvelope` belongs inline in the effect's `pipe`.** It is typed
  like core's `Effect.catchTags` and built on it: `E` is inferred from the
  piped effect, so a case for a tag the effect cannot fail with is a type
  error, the handled tags leave `E`, and every other error stays in the error
  channel with its original `Cause`. Bound to a `const` first and applied
  later, `E` infers as `unknown`, the unknown-tag check switches off, and a
  misspelled tag compiles and never matches.
- **`ToolOutcome.failure(tag, input)`** builds one `ok: false` value for a
  handler that decides on a failure without catching an error;
  `ToolOutcome.isFailure(value)` is `true` exactly when `value` is an object
  whose `ok` is `false`. It checks the discriminant, not the payload.

The success schema grows with every domain error a caller is expected to
branch on. Keep genuinely unexpected failures — the ones no caller should
special-case — as `Error`-instance declared failures, so the envelope stays
proportional to what an agent actually needs.

## Idempotent replay

A write tool an agent may retry — after a timeout, a dropped connection, a
restarted session — should not run its mutation twice. `ToolReplay.wrap`
returns a repeated call's stored first result, marked
`_idempotentReplay: true`, instead of running the handler again:

~~~ts
import { ToolOutcome, ToolReplay } from "@effected/mcp"
import { Effect, Option, Schema } from "effect"
import { Tool } from "effect/ai"
import { KeyValueStore } from "effect/persistence"

const Created = ToolReplay.success(Schema.Struct({ ...ToolOutcome.ok, id: Schema.Number }))

const Create = Tool.make("create", {
  description: "Create a thing.",
  parameters: Schema.Struct({ requestId: Schema.optionalKey(Schema.String), name: Schema.String }),
  success: Created,
  dependencies: [KeyValueStore.KeyValueStore],
})

declare const createThing: (params: { readonly name: string }) => Effect.Effect<{ readonly ok: true; readonly id: number }>

const create = ToolReplay.wrap({
  tool: "create",
  success: Created,
  key: (params: { readonly requestId?: string; readonly name: string }) => Option.fromUndefinedOr(params.requestId),
})(createThing)
~~~

Under `KeyValueStore.layerMemory`, two calls with `requestId: "r1"` answer
`{"ok":true,"id":1}` and then `{"ok":true,"id":1,"_idempotentReplay":true}`
— **even though the second call sent a different `name`.**

- **The store.** Omit `store` and `wrap` requires core's `KeyValueStore`
  (`effect/persistence`) in `R`: `KeyValueStore.layerMemory`,
  `layerFileSystem` or `layerSql`. Declare it in the tool's `dependencies`.
  Pass `store` — a `ToolReplayStore`, just `get` (answering `undefined` for a
  miss) and `set` — to back replay with your own table instead; `KeyValueStore`
  then leaves `R`. A `KeyValueStore` value satisfies `ToolReplayStore` as is.
- **The key is the request's whole identity.** A hit compares nothing else:
  not the params, not the schema version. A key reused with different params
  replays the first result, as above, so when params under one
  caller-supplied id can vary, fold a digest of them into the key.
  `Option.none()` runs the handler with nothing read or stored. Rows are
  stored under `<tool>:<key>`, and `wrap` throws at wrap time on a tool name
  containing `:`.
- **Rows never expire.** The store keeps a result until something removes it.
  A row written under an older schema replays whenever it still decodes; one
  that no longer decodes is a miss.
- **Build every object success member with `ToolReplay.success`.** It adds
  `ToolReplay.marker` (an optional `_idempotentReplay: true`); a success schema
  that does not declare it has the marker dropped by core's encoder on the
  replayed reply. `ToolReplay.success` is built on `Schema.fieldsAssign`, which
  does not carry a struct's own `.check(...)` refinements over: apply checks
  to its result, not to the struct you pass in.
- **Best-effort.** A failed lookup, an undecodable row and a failed write are
  a miss or a skipped write, logged at debug level, never a tool error. A
  handler failure stores nothing, and neither does an `ok: false` envelope
  result — a "not found" must not replay after the thing exists.
- **Wrap inside `catchAsEnvelope`**:
  `ToolReplay.wrap(options)(handler)` first, then
  `.pipe(ToolOutcome.catchAsEnvelope({ … }))` around it, so the envelope sees
  the handler's real errors and replay sees only real successes.
- **Replay, not exactly-once.** Two concurrent calls with one key both miss
  and both run the mutation. Serialize them yourself when that matters.

## Keeping a library's output off the wire

A handler that runs a chatty library in-process — a test runner, a bundler,
a linter — writes to the same stdout the JSON-RPC wire uses. `StdioCapture`
from `@effected/mcp/node` (Node only, since it imports `node:async_hooks`)
diverts writes made inside one async context while every other context, the
transport included, keeps writing to the real streams:

~~~ts
import { StdioCapture } from "@effected/mcp/node"

// main.ts, once:
const capture = StdioCapture.install(process)

// in a handler: the runner's console output goes to stderr, never the wire
const report = yield* runTests(files).pipe(capture.capture({ stdout: capture.toStderr }))
~~~

`install` patches each stream's `write` once — idempotent per stream, across
every installed copy of the package — and `capture.capture(options)` runs the
effect on its own fiber started inside the capture's context.
`capture.run(options, evaluate)` is the same for code that is not Effect.
`stderr` passes through when omitted. Sinks: `capture.toStderr` (the original,
unpatched stderr), `StdioCapture.discard` (drops writes, but is a bare sink
with no stream protocol), and `StdioCapture.nullWritable()` — a new Node
`Writable` that drops everything, for a library that expects a real stream it
can `pipe` into or call `setMaxListeners` on. It is a factory because a source
piped into it ends it; build one per consumer.

A server fiber woken by captured code keeps writing to the wire: a fiber
resumes in the async context it suspended in, not the one of whatever woke
it. Two kinds of write escape a capture:

- **Writes from a context the capture lost** reach the original stream — on
  stdout, the wire. A callback registered outside the capture keeps the
  context it was registered in: a native addon, worker-thread output relayed
  by the main thread, a listener on a child process's pipe attached earlier.
  Attach such listeners inside the capture, or route them to stderr yourself.
- **Fibers started inside the capture keep capturing after it ends.** A fiber
  forked inside it (`Effect.forkDetach`, a memoized layer first built inside
  it, a library's own background fiber) keeps writing to the sink after the
  capture's work is done. Build shared layers before the first capture.
