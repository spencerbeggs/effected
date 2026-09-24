# @effected/mcp

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
