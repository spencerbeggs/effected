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
import { ToolFailure } from "@effected/mcp";

console.log(ToolFailure.message("Config missing.", { hint: "Run init." }));
// => Config missing. Run init.
```

`ToolFailure.truncate` caps a caller-supplied value at `ToolFailure.ECHO_LIMIT` (200 UTF-16 code units) before it is echoed into a message, backing off one unit rather than splitting a surrogate pair. A value the engine itself produced — a path, a diagnostic — can take the larger `ToolFailure.ENGINE_ECHO_LIMIT` (2000):

```ts
import { ToolFailure } from "@effected/mcp";

console.log(ToolFailure.truncate("a".repeat(500)).length);
// => 201 (200 characters, then "…")

const enginePath = `/work/${"deep/".repeat(100)}file.ts`;
console.log(ToolFailure.truncate(enginePath, ToolFailure.ENGINE_ECHO_LIMIT) === enginePath);
// => true (under the 2000-unit engine cap)
```

`ToolFailure` is a static-namespace class with a private constructor — it is never instantiated.

## Putting it together

A stdio server's `main.ts` is one line, plus the layer that wires it:

```ts
import { McpStdio, McpToolkit, ToolFailure } from "@effected/mcp";
import { NodeRuntime, NodeStdio } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  ...ToolFailure.fields,
  id: Schema.String,
}) {}

const GetThing = Tool.make("get_thing", {
  description: "Fetch a thing by id.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ name: Schema.String }),
  failure: NotFound,
});

const MyTools = Toolkit.make(GetThing);

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
});

const ToolsLayer = McpToolkit.layer(MyTools).pipe(Layer.provide(MyHandlers));
const ServerLayer = ToolsLayer.pipe(
  Layer.provideMerge(McpStdio.layer({ name: "my-server", version: "1.0.0" })),
);

// The platform Stdio is the one service provided at the edge.
const Main = ServerLayer.pipe(Layer.provide(NodeStdio.layer));

NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown });
```

The platform `Stdio` is the one service provided at the edge: `ServerLayer`
still requires it, and `Main` supplies `NodeStdio.layer` from
`@effect/platform-node` just before launch. Leave that line out and
`McpStdio.launch(Main)` fails to typecheck, because `Stdio` is still in its
requirements. Test `ServerLayer`, never `Main`: `McpHarness.make` supplies
its own queue-backed `Stdio`.

`McpToolkit.layer` re-annotates every tool without its own `Tool.Strict`
annotation to strict by default, so `get_thing({ id: "known", extra: 1 })`
is rejected with one `Unrecognized parameter(s): extra. Accepted params:
id.` before the handler ever runs — see [Strict input](#strict-input)
below.

## The stdio boundary

`McpStdio.layer` is core's `McpServer.layerStdio` with every log line sent to
stderr, and with stdin read through a guard. Core's own stdio decoder throws on
a line that is not JSON without ever trimming it from its buffer, so one bad
line wedges the server: every later request goes unanswered while stdin EOF
still exits 0. The guard frames stdin exactly as core does — one streaming
UTF-8 decoder, a byte-order mark stripped only at the start of the stream,
lines split on `\n` — and answers each line core would choke on itself, on
stdout:

- a line that is not JSON gets a JSON-RPC parse error,
  `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}`,
  and the server keeps serving the lines after it;
- a line longer than core's cap of 16 Mi UTF-16 code units gets the same
  reply once, as soon as it passes the cap, and the rest of it is discarded
  up to its newline;
- a line that is JSON but no JSON-RPC message gets an Invalid Request,
  `{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}}`,
  and the server keeps serving. That covers a value that is neither an object
  nor an array (core throws on a bare `null`, dropping every other frame that
  arrived in the same chunk, and ignores a number, string or boolean without a
  reply), an object whose `method` is not a string and whose `id` is absent or
  `null` (core throws on that too), and an object with neither `method` nor
  `id`, which is neither a request nor a response;
- a line of JSON whitespace (space, tab, carriage return) is ignored.

Every other line goes to core. That includes an array, which core answers with
`-32600` itself because it serves no batches, and an object with an `id` and
no `method`, which is a response and never gets a reply.

**Give each server a fresh layer memo map.** Core's stdio protocol layer is a
shared constant, so a second `McpStdio.layer` server whose build sees the
first one's memo map shares its protocol: only the first server reads stdin,
and the second never answers. Merging both into one graph does that, and so
does building or providing the second anywhere under the first one's
`Effect.provide` — a nested `Layer.build` or `Effect.provide` forks the
ambient memo map rather than starting a new one. Isolate each server with its
own `ManagedRuntime`, `Effect.provide(layer, { local: true })`, or its own
process.

## Strict input

Two ways to close a tool's input schema against unknown keys, at different
scopes:

- **`ToolInputSchema`** — pure walkers, for a `Tool.dynamic` tool,
  whose raw JSON Schema core never validates strictly: run
  `ToolInputSchema.unknownKeys(payload, schema)` inside its handler against
  the schema you registered, usually paired with `objectRooted(schema)`,
  because a top-level discriminated union only reaches a server as raw
  JSON Schema — core dies at boot on a union root. Not for a `Tool.make`
  tool: core decodes its payload before the handler runs, so an excess key
  is already dropped or rejected by then.
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
import type { Tool, Toolkit } from "effect/unstable/ai";

// The toolkit and its handlers, as built in "Putting it together".
declare const MyTools: Toolkit.Toolkit<Record<string, Tool.Any>>;
declare const MyHandlers: Layer.Layer<never>;

// Default: every tool is strict, and every rejection names every unknown key.
const ToolsLayer = McpToolkit.layer(MyTools).pipe(Layer.provide(MyHandlers));

// Only tools explicitly annotated Tool.Strict are decoded strict.
const LenientByDefault = McpToolkit.layer(MyTools, { strict: "annotated" }).pipe(Layer.provide(MyHandlers));
```

The dynamic-tool recipe, with the handler reporting every unknown key:

```ts
import { McpToolkit, ToolInputSchema } from "@effected/mcp";
import { Effect, Layer, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

// A top-level union, written as raw JSON Schema and rewritten to an object root.
const EditInput = ToolInputSchema.objectRooted({
  anyOf: [
    {
      type: "object",
      properties: {
        action: { const: "rename" },
        to: { type: "string" },
        options: { type: "object", properties: { force: { type: "boolean" } }, additionalProperties: false },
      },
      required: ["action", "to"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { action: { const: "delete" } },
      required: ["action"],
      additionalProperties: false,
    },
  ],
});

class UnknownKeys extends Schema.TaggedError<UnknownKeys>()("UnknownKeys", { message: Schema.String }) {}

const Edit = Tool.dynamic("edit", {
  description: "Rename or delete a thing.",
  parameters: EditInput,
  failure: UnknownKeys,
});

const EditTools = Toolkit.make(Edit);

const EditHandlers = EditTools.toLayer({
  // A dynamic tool is decoded as Schema.Unknown: the handler sees the raw payload.
  edit: (payload) => {
    const levels = ToolInputSchema.unknownKeys(payload, EditInput);
    return levels.length > 0
      ? Effect.fail(new UnknownKeys({ message: ToolInputSchema.formatUnknownKeys(levels) }))
      : Effect.succeed(payload);
  },
});

// McpToolkit never re-annotates a Tool.dynamic tool, so it stays lenient and the handler reports.
const EditLayer = McpToolkit.layer(EditTools).pipe(Layer.provide(EditHandlers));
```

```text
edit({ action: "rename", to: "b", extra: 1, options: { force: true, bogus: 2 } })
=> Unrecognized parameter(s): extra. Accepted params: action, to, options. Unrecognized parameter(s): options.bogus. Accepted params: force.
```

## Testing

`@effected/mcp/testing` is a separate entrypoint — importing it never pulls
test machinery into a server's runtime import graph.

```ts
import { McpHarness } from "@effected/mcp/testing";
import { Effect, type Layer, type Stdio } from "effect";
import type { McpServer } from "effect/unstable/ai";

// The server layer from "Putting it together" — still requiring Stdio.
declare const ServerLayer: Layer.Layer<McpServer.McpServer, never, Stdio.Stdio>;

const test = Effect.gen(function* () {
  const client = yield* McpHarness.make(ServerLayer);
  yield* client.initialize; // initialize + notifications/initialized: every stateful revision requires it
  const result = yield* client.callTool("get_thing", { id: "known" });
  // result.result.structuredContent === { name: "a known thing" }
  yield* client.close;
});
```

On a stateful revision (the default is `2025-11-25`), `initialize` comes
first: any other request sent before it fails fast with `McpTestFailure`
reason `NotInitialized` instead of the server's opaque `Invalid request
metadata`.

`McpHarness.make` runs the server in-process over queue-backed `Stdio`, so
a test sees the exact served schemas and wire results a real client would,
with no child process and no sockets. Pass `server` **without** a `Stdio`
of its own — a `Stdio` the server provides internally would talk to the
real terminal instead of the test's queues. The harness builds the server
with a fresh layer memo map, never the ambient one, so a harness made under
another stdio server's `Effect.provide` still serves its own. For the same
reason, never pass a server layer that provides a layer the test also
provides and then reads: `McpHarness.make(server.pipe(Layer.provide(AppLayer)))`
under `Effect.provide(AppLayer)` builds `AppLayer` twice, so the tools write
to one instance and the test reads the other. Leave the service in the
server layer's requirements and provide it once from the test, or build it
once and pass `Layer.succeed(Tag, value)`. `McpProcess.spawn` and
`McpProbe.initialize` are the spawned-bin equivalents, for a test that
must exercise a built artifact rather than a layer — `McpProbe` in
particular is the MCP half of a packed-install proof: it keeps stdin open
until the response arrives, and the caller asserts
`result.response.error === undefined`, empty `stderr` and exit 0 — a
server that refuses the handshake still answers, exits 0 and stays quiet.
`McpToolAudit.check` is a pure sweep over a served `tools/list`, for a
static policy check with no server at all.

`McpProcess` writes a JSON-encoded message with `send`, and anything at all
with `sendRaw(text: string | Uint8Array)`, which writes the string or bytes
verbatim. `sendRaw` is the only way to put genuinely malformed input on a
server's stdin — `send` and `McpHarness` always encode valid JSON — so it is
how a test proves the stdin guard against a spawned server:

```ts
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { McpProcess } from "@effected/mcp/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

// A minimal server, written to disk so it can be spawned as a real process.
const serverFile = join(import.meta.dirname, "mcp-guard-demo-server.mjs");
writeFileSync(
  serverFile,
  `
import { McpStdio, McpToolkit } from "@effected/mcp";
import { NodeRuntime, NodeStdio } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

const Ping = Tool.make("ping", { description: "Liveness check.", parameters: Tool.EmptyParams });
const Tools = Toolkit.make(Ping);
const Handlers = Tools.toLayer({ ping: () => Effect.void });
const Main = McpToolkit.layer(Tools).pipe(
  Layer.provide(Handlers),
  Layer.provideMerge(McpStdio.layer({ name: "guard-demo", version: "0.0.0" })),
  Layer.provide(NodeStdio.layer),
);

NodeRuntime.runMain(McpStdio.launch(Main), { teardown: McpStdio.teardown });
`,
);

const program = Effect.gen(function* () {
  const server = yield* McpProcess.spawn(ChildProcess.make(process.execPath, [serverFile]));
  yield* server.handshake(); // always id 1
  // A bad line and a good one, in the same write.
  yield* server.sendRaw('not json\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  const { response, seen } = yield* server.readUntilResponse(2);
  console.log("answered the bad line:", seen.some((frame) => (frame as { id: unknown }).id === null));
  console.log("kept serving:", Array.isArray((response.result as { tools: unknown }).tools));
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.timeout("5 seconds"));

await Effect.runPromise(program).finally(() => unlinkSync(serverFile));
// => answered the bad line: true
// => kept serving: true
```

## Tier

Boundary tier. Peers: `@effected/engine` and `effect`. Nothing in the kit depends on `@effected/mcp` except an application; it never depends on `@effected/cli` or `@effected/workspaces` — a CLI boundary and an MCP boundary are siblings, both front ends, never layers on each other.

## License

[MIT](LICENSE)
