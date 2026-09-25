# @effected/mcp

## 0.2.0

### Features

- `McpToolkit.unionTool` and `McpToolkit.unionHandler` register a tool whose
  `parameters` is a `Schema.Union` of objects — something `Tool.make` cannot
  take, since core dies at registration on a non-object `parameters` root.
  The tool is served as a `Tool.dynamic` with Effect's strict JSON Schema
  document for the union, rewritten to an object root, and gets the same
  treatment as a strict `Tool.make` tool: every unknown key named in one
  `InvalidParams`, then a strict decode, both before the handler runs.

  ```ts
  import { McpToolkit, ToolOutputSchema, ToolRefusal } from "@effected/mcp";
  import { Schema, Tool } from "effect";

  const Note = McpToolkit.unionTool("note", {
    parameters: Schema.Union([AddNote, ListNotes]),
    success: ToolOutputSchema.objectRooted(Schema.Union([Added, Listed])),
    failure: ToolRefusal,
  }).annotate(Tool.Title, "Note");

  const handlers = Kit.toLayer({
    note: McpToolkit.unionHandler(Note, (params) => handleNote(params)),
  });
  ```

- `ToolOutputSchema.objectRooted` adds `type: "object"` beside a union's
  `anyOf` at a schema's JSON Schema root, so a tool's `outputSchema` is one
  every client accepts — MCP requires an object-rooted `outputSchema`, and a
  bare `Schema.Union` at the top emits a bare `anyOf` that the stateful
  revisions drop from `tools/list` and the stateless one serves to a client
  that rejects it.

- `ToolRefusal` is a ready-made declared failure for a tool call refused for
  a reason the caller can fix. Declare it in a tool's `failure` schema and
  fail with `ToolRefusal.refuse`, whose message already folds in the
  remediation:

  ```ts
  return yield* ToolRefusal.refuse(`No run "${ToolFailure.truncate(id)}".`, {
    hint: "List runs first.",
    suggestedTool: "list_runs",
  });
  ```

- A new `@effected/mcp/guard` entrypoint carries `McpGuard.run`: crash guards
  for an MCP server process, installed before the server's module graph
  loads. It registers `uncaughtException` and `unhandledRejection`
  listeners, then loads and launches the server, reporting every stray crash
  on stderr instead of leaving it to escape onto stdout, the JSON-RPC wire.
  A policy chooses whether an uncaught exception or rejection exits the
  process immediately (`"exit"`) or only before the server starts serving
  (`"exitBeforeConnect"`, so a server that dies mid-session does not
  deregister its tools from the client). The entrypoint has no static
  runtime import — only `McpGuardHost`, the slice of `process` it needs, is
  imported as a type — so a throw while `effect` or the server graph itself
  evaluates is still reported. `injectCrash` drives either half of the
  policy end to end from a test, through `McpGuardHost.emit`.

- `McpStdio.launch` takes a new `onReady` option, run once the whole layer
  has built and before the launch waits forever — the signal `McpGuard.run`
  uses to know when a server is "connected".

- `McpHarness.initializeWith(protocolVersion)` sends `initialize` asking for
  an arbitrary `protocolVersion` instead of the harness's own revision, and
  `sentSoFar` returns every frame written to the server's stdin so far, in
  order — both for testing protocol-version negotiation and traffic
  directly.

### Documentation

- Running two stdio servers in one process now documents the full isolation
  rule: wrap each server's **whole bundle** (its toolkit layers together
  with `McpStdio.layer`) in `Layer.fresh`. A `Layer.fresh` boundary placed
  only around `McpStdio.layer`, with the toolkit outside it, builds a second,
  empty tool registry, so that server serves no tools. [#840][#840]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.1.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#840]: https://github.com/spencerbeggs/effected/pull/840

## 0.1.1

### Documentation

- `McpHarness` and `McpTestFailure` no longer claim a stateful revision always refuses a request sent before `initialize` with `Invalid request metadata`. That `-32602` comes from a stateless adapter listed first, as in `McpStdio.protocols`; a server that serves only stateful revisions answers `-32603 Internal error`.
- The README no longer says core's wedged stdio server exits 0 at stdin EOF. It ends with the status a healthy session ends with, which is 0 only under `McpStdio.teardown`. [#824][#824]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#824]: https://github.com/spencerbeggs/effected/pull/824

## 0.1.0

### Features

- First release. `@effected/mcp` is the boundary layer of an MCP server built on `effect/unstable/ai`: core keeps the protocol, tool registration and the wire format, and this package fixes the defaults servers kept getting wrong. Its peers are `effect` and `@effected/engine`.

#### Stdio servers that keep stdout the wire

- `McpStdio.layer({ name, version })` — core's stdio server with every log line sent to stderr and stdin read through a guard. Core's own decoder wedges on the first line it cannot parse; the guard answers that line itself and the server keeps serving. A line that is not JSON gets a `-32700` Parse error, JSON that is no JSON-RPC message gets a `-32600` Invalid Request, and an over-long line is answered once and discarded.
- `McpStdio.launch(layer)` and `McpStdio.teardown` — run the server from `main` without a launch failure or crash report ever reaching stdout.

```ts
import { McpStdio, McpToolkit } from "@effected/mcp";
import { NodeRuntime, NodeStdio } from "@effect/platform-node";
import { Layer } from "effect";

// MyTools is a Toolkit.make(...) toolkit; MyHandlers is its handlers layer.
const ServerLayer = McpToolkit.layer(MyTools).pipe(
	Layer.provide(MyHandlers),
	Layer.provideMerge(McpStdio.layer({ name: "my-server", version: "1.0.0" })),
);

NodeRuntime.runMain(McpStdio.launch(ServerLayer.pipe(Layer.provide(NodeStdio.layer))), {
	teardown: McpStdio.teardown,
});
```

#### Tools

- `McpToolkit.layer(toolkit, options?)` — registers a toolkit strict by default: every tool without its own `Tool.Strict` annotation is served and decoded strict (`strict: "all"`), and a rejected call names every unknown key at every depth in one response. Pass `{ strict: "annotated" }` to leave unannotated tools lenient. A `Tool.dynamic` tool is never re-annotated.
- `ToolFailure` — a shared shape for a tool's typed failure. Core sends the agent only the error's `message`, so spread `ToolFailure.fields` (`message` plus an `@effected/engine` `Remediation`) into a `Schema.TaggedError`, fold the remediation in with `ToolFailure.message`, and cap echoed caller input with `ToolFailure.truncate`.
- `ToolInputSchema` — pure walkers for a `Tool.dynamic` tool's raw JSON Schema: `unknownKeys` and `formatUnknownKeys` report every unknown key, and `objectRooted` rewrites a top-level union to the object root a server needs.

#### `@effected/mcp/testing`

- A separate entrypoint, so a server's runtime import graph never loads test code.

- `McpHarness.make(serverLayer)` — an in-process client over queue-backed stdio, with `initialize`, `listTools`, `callTool`, `listResources`, `readResource` and `close`. A request sent before `initialize` fails fast with `McpTestFailure` reason `NotInitialized`, and each harness builds the server with its own layer memo map.

- `McpProcess.spawn(command)` — a client for a spawned server bin that never hangs. `sendRaw` writes bytes verbatim, so a test can prove the stdin guard with malformed input.

- `McpProbe.initialize(command)` — one initialize handshake against a built bin, the MCP half of a packed-install proof.

- `McpToolAudit.check(tools, policy)` — a pure policy sweep over a served `tools/list`, with no server needed.

- `McpTestFailure` — the tagged failure every test client reports. [#821][#821]

```ts
import { McpHarness } from "@effected/mcp/testing";
import { Effect } from "effect";

const test = Effect.gen(function* () {
	const client = yield* McpHarness.make(ServerLayer); // the server layer, still requiring Stdio
	yield* client.initialize;
	const result = yield* client.callTool("get_thing", { id: "known" });
	yield* client.close;
});
```

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | updated | 0.0.0 | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#821]: https://github.com/spencerbeggs/effected/pull/821
