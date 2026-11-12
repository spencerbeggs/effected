# Resources: registration, the mimeType on a read, and URI templates

Loaded from `effect-v4-mcp`. Covers `McpServer.resource`'s two forms (a
single resource, a URI template), how each `content` form
carries its declared `mimeType` on a read, dynamic resource sets, and the router limit on
a template variable.

## Registering a resource

`McpServer.resource({ uri, name, description, mimeType, content })` returns
a `Layer` — merge it next to the toolkit, the same way `McpToolkit.layer`
is:

~~~ts
import { McpStdio } from "@effected/mcp-kit"
import { Effect, Layer } from "effect"
import { McpServer } from "effect/ai"

const Notes = McpServer.resource({
  uri: "notes://all",
  name: "notes",
  mimeType: "text/plain",
  content: Effect.succeed({ contents: [{ uri: "notes://all", mimeType: "text/plain", text: "no notes yet" }] }),
})

const ServerLayer = Notes.pipe(Layer.provideMerge(McpStdio.layer({ name: "notes-server", version: "0.0.0" })))
~~~

A resource read failure is `new McpSchema.InternalError({ message })`.

## The `mimeType` on a read

`content` can return a bare `string`, a `Uint8Array`, or a whole
`ReadResourceResult` (`{ contents: [{ uri, mimeType, text }] }`). Core's own
`resolveResourceContent` (`ai/McpServer.ts:4221-4236`) wraps a bare string
as `{ contents: [{ uri, mimeType, text }] }` and bytes as
`{ contents: [{ uri, mimeType, blob }] }`, copying the registered
`mimeType` onto the read, and passes a full `ReadResourceResult` through
unchanged. So every form carries the declared type on `resources/read` as
well as in `resources/list`, and an MCP Apps host can render a UI resource
served as `text/html;profile=mcp-app` from a bare string. Return the full
shape only when one read needs several contents, or a per-content type that
differs from the registered one: a full result is sent as written, so its
own `mimeType` is the one the client sees.

~~~ts
import { McpStdio } from "@effected/mcp-kit"
import { McpHarness } from "@effected/mcp-kit/testing"
import { Effect, Layer } from "effect"
import { McpServer } from "effect/ai"

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

Prints `string form has mimeType: true`, `full form has mimeType: true`,
and `declared mimeType still in resources/list for string form: text/plain`:
both read forms put the declared type on the wire, and the listing carries
it too.

## URI templates

`McpServer.resource` has a second, tagged-template form for a parameterized
URI, named with `McpSchema.param`:

~~~ts
import { Effect, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"

const id = McpSchema.param("id", Schema.String)
const Item = McpServer.resource`x://item/${id}`({
  name: "item",
  content: (uri, value) => Effect.succeed(`${uri}:${value}`),
})
~~~

## A template variable cannot span a slash

The router behind a template match is `FindMyWay` (`ai/McpServer.ts:26`,
`makeUriMatcher`), and its route syntax (`:paramName`, built by
`compileUriTemplate`) matches exactly one path segment — the same
single-segment rule any `FindMyWay`-backed router applies. An id containing
a slash, such as `concepts/foo`, has no way to reach a templated resource:
the router reports no match, and the client sees `ResourceNotFound`, not a
decode error.

~~~ts
import { McpStdio } from "@effected/mcp-kit"
import { McpHarness } from "@effected/mcp-kit/testing"
import { Effect, Layer, Schema } from "effect"
import { McpSchema, McpServer } from "effect/ai"

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
