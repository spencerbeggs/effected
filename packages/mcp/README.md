# @effected/mcp

The boundary layer of an `effect/unstable/ai` MCP server: stdio wiring that keeps stdout the JSON-RPC wire, tool-failure shaping, and strict-input walkers, plus a `./testing` subpath for driving a built server from a test.

[![npm](https://img.shields.io/npm/v/@effected%2Fmcp?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Install

```bash
npm install @effected/mcp @effected/engine effect
```

```bash
pnpm add @effected/mcp @effected/engine effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 and `@effected/engine` are the only peer dependencies. Boundary tier: `src/` reads no `process` token, imports no `node:` module and no `@effect/platform*` package, and calls no `console.*` — stdout is the JSON-RPC wire a server writes over.

## ToolFailure

Core's MCP server sends a tool's declared failure — an `Error` instance, which every `Schema.TaggedError` is — as `isError: true` with `error.message` as the only text and no `structuredContent`. Whatever is not folded into `message` when the error is constructed never reaches the agent. `ToolFailure` is the shared shape for doing that folding consistently across a server's tools.

Spread `ToolFailure.fields` into a tool's `Schema.TaggedError`, build `message` with `ToolFailure.message`, and pass every caller-supplied value through `ToolFailure.truncate` before echoing it back:

```ts
import { ToolFailure } from "@effected/mcp";
import { Schema } from "effect";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  ...ToolFailure.fields,
  id: Schema.String,
}) {}

const remediation = { hint: "List the ids first.", suggestedTool: "list_things" };
const id = "missing-id";

const error = new NotFound({
  id,
  remediation,
  message: ToolFailure.message(`No thing "${ToolFailure.truncate(id)}".`, remediation),
});

console.log(error.message);
// => No thing "missing-id". List the ids first. Try list_things.
```

`ToolFailure.message` drops any empty part, so an omitted `suggestedTool` or an empty `hint` never leaves a double space:

```ts
ToolFailure.message("Config missing.", { hint: "Run init." });
// => "Config missing. Run init."
```

`ToolFailure.truncate` caps a caller-supplied value at `ToolFailure.ECHO_LIMIT` (200 UTF-16 code units) before it is echoed into a message, backing off one unit rather than splitting a surrogate pair. A value the engine itself produced — a path, a diagnostic — can take the larger `ToolFailure.ENGINE_ECHO_LIMIT` (2000):

```ts
ToolFailure.truncate("a".repeat(500));
// => "aaaa…aaaa" (200 characters, then "…")

ToolFailure.truncate(enginePath, ToolFailure.ENGINE_ECHO_LIMIT);
```

`ToolFailure` is a static-namespace class with a private constructor — it is never instantiated.

## Putting it together

A stdio server's `main.ts` is one line, plus the layer that wires it:

```ts
import { McpStdio, McpToolkit, ToolFailure } from "@effected/mcp";
import { Effect, Layer, Schema } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { Tool, Toolkit } from "effect/unstable/ai";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  ...ToolFailure.fields,
  id: Schema.String,
}) {}

const GetThing = Tool.make("get_thing", {
  description: "Fetch a thing by id.",
  parameters: { id: Schema.String },
  success: Schema.Struct({ name: Schema.String }),
  failure: NotFound,
});

const MyTools = Toolkit.make(GetThing);

const MyHandlers = MyTools.toLayer(
  Effect.gen(function* () {
    return {
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
    };
  }),
);

const ToolsLayer = McpToolkit.layer(MyTools).pipe(Layer.provide(MyHandlers));
const ServerLayer = ToolsLayer.pipe(
  Layer.provideMerge(McpStdio.layer({ name: "my-server", version: "1.0.0" })),
);

const Main = ServerLayer; // add more subsystems here with Layer.mergeAll

NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown });
```

`McpToolkit.layer` re-annotates every tool without its own `Tool.Strict`
annotation to strict by default, so `get_thing({ id: "known", extra: 1 })`
is rejected with one `Unrecognized parameter(s): extra. Accepted params:
id.` before the handler ever runs — see [Strict input](#strict-input)
below.

## Strict input

Two ways to close a tool's input schema against unknown keys, at different
scopes:

- **`ToolInputSchema`** — pure walkers, for a server that does not (or
  cannot yet) adopt `McpToolkit`: run `ToolInputSchema.unknownKeys(payload,
  tool.inputSchema)` inside a handler, or `objectRooted(schema)` when a
  tool's parameters are a top-level discriminated union — core dies at boot
  on an unrewritten union root.
- **`McpToolkit.layer(toolkit, options?)`** — the registration-scoped
  decorator, and the recommended default: every tool without its own
  `Tool.Strict` annotation is served and decoded strict
  (`options.strict` defaults to `"all"`), and a rejected call names every
  unknown key at every depth in one response, not just the first. An
  explicit `Tool.Strict` annotation always wins, and a `Tool.dynamic` tool
  is never re-annotated. Pass `{ strict: "annotated" }` to leave
  unannotated tools lenient, or annotate an individual tool
  `Tool.Strict` false to opt it out under the default.

```ts
import { McpToolkit } from "@effected/mcp";
import { Layer } from "effect";

// Default: every tool is strict, and every rejection names every unknown key.
const ToolsLayer = McpToolkit.layer(MyTools).pipe(Layer.provide(MyHandlers));

// Only tools explicitly annotated Tool.Strict are decoded strict.
const LenientByDefault = McpToolkit.layer(MyTools, { strict: "annotated" }).pipe(Layer.provide(MyHandlers));
```

## Testing

`@effected/mcp/testing` is a separate entrypoint — importing it never pulls
test machinery into a server's runtime import graph.

```ts
import { McpHarness } from "@effected/mcp/testing";
import { Effect } from "effect";

const test = Effect.gen(function* () {
  const client = yield* McpHarness.make(ServerLayer);
  const result = yield* client.callTool("get_thing", { id: "known" });
  // result.result.structuredContent === { name: "a known thing" }
  yield* client.close;
});
```

`McpHarness.make` runs the server in-process over queue-backed `Stdio`, so
a test sees the exact served schemas and wire results a real client would,
with no child process and no sockets. Pass `server` **without** a `Stdio`
of its own — a `Stdio` the server provides internally would talk to the
real terminal instead of the test's queues. `McpProcess.spawn` and
`McpProbe.initialize` are the spawned-bin equivalents, for a test that
must exercise a built artifact rather than a layer — `McpProbe` in
particular is the MCP half of a packed-install proof: it keeps stdin open
until the response arrives, then asserts empty stderr and exit 0.
`McpToolAudit.check` is a pure sweep over a served `tools/list`, for a
static policy check with no server at all.

## Tier

Boundary tier. Peers: `@effected/engine` and `effect`. Nothing in the kit depends on `@effected/mcp` except an application; it never depends on `@effected/cli` or `@effected/workspaces` — a CLI boundary and an MCP boundary are siblings, both front ends, never layers on each other.

## License

[MIT](LICENSE)
