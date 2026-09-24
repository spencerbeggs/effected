# Resources: registration, the mimeType trap, and URI templates

Loaded from `effect-v4-mcp`. Covers `McpServer.resource`'s two forms (a
single resource, a URI template), what a `content` Effect must return to
keep its declared `mimeType`, dynamic resource sets, and the router limit on
a template variable.

## Registering a resource

`McpServer.resource({ uri, name, description, mimeType, content })` returns
a `Layer` — merge it next to the toolkit, the same way `McpToolkit.layer`
is:

~~~ts
import { McpStdio } from "@effected/mcp"
import { Effect, Layer } from "effect"
import { McpServer } from "effect/unstable/ai"

const Notes = McpServer.resource({
  uri: "notes://all",
  name: "notes",
  mimeType: "text/plain",
  content: Effect.succeed({ contents: [{ uri: "notes://all", mimeType: "text/plain", text: "no notes yet" }] }),
})

const ServerLayer = Notes.pipe(Layer.provideMerge(McpStdio.layer({ name: "notes-server", version: "0.0.0" })))
~~~

A resource read failure is `new McpSchema.InternalError({ message })`.

## The `mimeType` trap

`content` can return a bare `string`, a `Uint8Array`, or a whole
`ReadResourceResult` (`{ contents: [{ uri, mimeType, text }] }`). Core's own
`resolveResourceContent` (`unstable/ai/McpServer.ts:2525-2545`) wraps a bare
string as `{ contents: [{ uri, text }] }` — **no `mimeType` field at
all** — and passes a full `ReadResourceResult` through unchanged. The
declared `mimeType` option still appears correctly in `resources/list`
either way; only the actual `resources/read` response differs. Always
return the full shape when the client needs the mime type on the read
itself, not only in the listing.

~~~ts
import { McpStdio } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer } from "effect"
import { McpServer } from "effect/unstable/ai"

const StringForm = McpServer.resource({
  uri: "x://string",
  name: "string-form",
  mimeType: "text/plain",
  content: Effect.succeed("hello"),
})

const FullForm = McpServer.resource({
  uri: "x://full",
  name: "full-form",
  mimeType: "text/plain",
  content: Effect.succeed({ contents: [{ uri: "x://full", mimeType: "text/plain", text: "hello" }] }),
})

const ServerLayer = Layer.mergeAll(StringForm, FullForm).pipe(
  Layer.provideMerge(McpStdio.layer({ name: "resource-probe", version: "0.0.0" })),
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const harness = yield* McpHarness.make(ServerLayer)
    yield* harness.initialize
    const stringRead = yield* harness.readResource("x://string")
    const fullRead = yield* harness.readResource("x://full")
    console.log(
      "string form has mimeType:",
      (stringRead.result as { contents: ReadonlyArray<{ mimeType?: string }> }).contents[0]?.mimeType !== undefined,
    )
    console.log(
      "full form has mimeType:",
      (fullRead.result as { contents: ReadonlyArray<{ mimeType?: string }> }).contents[0]?.mimeType !== undefined,
    )
    const listed = yield* harness.request("resources/list")
    console.log(
      "declared mimeType still in resources/list for string form:",
      (listed.result as { resources: ReadonlyArray<{ uri: string; mimeType?: string }> }).resources.find(
        (r) => r.uri === "x://string",
      )?.mimeType,
    )
  }),
)

await Effect.runPromise(program)
~~~

Prints `string form has mimeType: false`, `full form has mimeType: true`,
and `declared mimeType still in resources/list for string form: text/plain`
— confirming the brief's claim exactly: the declared value survives the
listing either way, but only the full-shape read keeps it on the wire.

## URI templates

`McpServer.resource` has a second, tagged-template form for a parameterized
URI, named with `McpSchema.param`:

~~~ts
import { Effect, Schema } from "effect"
import { McpSchema, McpServer } from "effect/unstable/ai"

const id = McpSchema.param("id", Schema.String)
const Item = McpServer.resource`x://item/${id}`({
  name: "item",
  content: (uri, value) => Effect.succeed(`${uri}:${value}`),
})
~~~

## A template variable cannot span a slash

The router behind a template match is `FindMyWay` (`unstable/ai/McpServer.ts:36`,
`makeUriMatcher`), and its route syntax (`:paramName`, built by
`compileUriTemplate`) matches exactly one path segment — the same
single-segment rule any `FindMyWay`-backed router applies. An id containing
a slash, such as `concepts/foo`, has no way to reach a templated resource:
the router reports no match, and the client sees `ResourceNotFound`, not a
decode error.

~~~ts
import { McpStdio } from "@effected/mcp"
import { McpHarness } from "@effected/mcp/testing"
import { Effect, Layer, Schema } from "effect"
import { McpSchema, McpServer } from "effect/unstable/ai"

const id = McpSchema.param("id", Schema.String)
const Template = McpServer.resource`x://item/${id}`({
  name: "item",
  content: (uri, value) => Effect.succeed(`${uri}:${value}`),
})

const ServerLayer = Template.pipe(Layer.provideMerge(McpStdio.layer({ name: "template-probe", version: "0.0.0" })))

const program = Effect.scoped(
  Effect.gen(function* () {
    const harness = yield* McpHarness.make(ServerLayer)
    yield* harness.initialize
    const single = yield* harness.readResource("x://item/a")
    console.log("single-segment id resolves:", single.error === undefined)
    const spanning = yield* harness.readResource("x://item/a/b")
    console.log(
      "multi-segment id fails:",
      spanning.error !== undefined ? JSON.stringify(spanning.error) : "NO ERROR — matched",
    )
  }),
)

await Effect.runPromise(program)
~~~

Prints `single-segment id resolves: true` then `multi-segment id fails:
{"code":-32002,"message":"Resource 'x://item/a/b' not found"}` — the
`/`-containing id never reaches the template's `content` handler at all.

Because of this, an id set that can contain a slash needs one **static**
resource per id instead of a template. Build the set once, at boot, as
`Layer.unwrap(Effect.gen(...))`, loading the collection and reduce-merging
one `McpServer.resource` layer per item from `Layer.empty`; on a load
failure, `tapError(Effect.logError)` then `orElseSucceed(() => Layer.empty)`
so the rest of the server — its tools included — still comes up even when
the resource collection itself failed to load.
