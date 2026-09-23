# @effected/mcp

The boundary layer of an `effect/unstable/ai` MCP server: stdio wiring that keeps stdout the JSON-RPC wire, tool-failure shaping, and strict-input walkers, plus a `./testing` module of clients for driving a built server from a test. Tier: boundary. `effect` and `@effected/engine` are the only peers — no `@effect/platform*` package, no `node:` import, no `console.*` call anywhere in `src/`.

## Import

```ts
import { McpStdio, McpToolkit, ToolFailure, ToolInputSchema } from "@effected/mcp";
import { McpHarness, McpProbe, McpProcess, McpTestFailure, McpToolAudit } from "@effected/mcp/testing";
```

Two entrypoints. `./testing` is a separate module so test machinery never enters a server's runtime import graph — a reachability test pins that the two graphs never cross. Protocol handling, tool registration and the wire format stay `effect/unstable/ai`'s job, not this package's.

## Feature surface

| Reach for | When |
| --- | --- |
| `McpStdio.launch(Main)` + `McpStdio.teardown` | the one-line `main.ts` for any stdio MCP server |
| `McpStdio.layer(options)` | building the server layer by hand instead of using `launch` |
| `ToolFailure.fields` / `.message` / `.truncate` | a tool's declared failure must read as a sentence, because core sends only `error.message` |
| `ToolInputSchema.unknownKeys` / `.formatUnknownKeys` | naming every unknown key in a `Tool.dynamic` tool's raw payload, inside its handler — core never validates raw JSON Schema strictly |
| `ToolInputSchema.objectRooted` | a `Tool.dynamic` tool's raw JSON Schema is a top-level discriminated union — core dies at boot on the unrewritten union |
| `McpToolkit.layer(toolkit, options?)` | registering a toolkit with strict-by-default input and complete, path-qualified rejection messages |
| `McpHarness.make(server)` | an in-process test client for a server layer — the default for testing a server |
| `McpProcess.spawn(command)` | a test must drive a **spawned** bin, not an in-process layer |
| `McpProbe.initialize(command)` | the MCP half of a packed-install proof: one `initialize`, a clean close, exit 0 |
| `McpToolAudit.check(tools, policy)` | a pure, server-free policy sweep over what `tools/list` actually serves |

## Core API

- **`McpStdio`** — `McpStdio.protocols` is `[McpProtocol.v2026_07_28, v2025_11_25, v2025_06_18]`: stateless first, because real clients (Claude Code 2.1.281, measured) open with `server/discover` rather than `initialize`; never a single entry, since `initialize` only matches stateful adapters; at most one stateless adapter. `McpStdio.layer(options)` → `Layer<McpServer | McpServerClient, never, Stdio>` is `McpServer.layerStdio` with `LogToStderr` **merged** into its own output (`Layer.provideMerge`, so every layer it provides logs to stderr too — a `Layer.mergeAll` sibling is not provided by it and does not inherit the setting) and `Layer.orDie` (a bad `protocols` list is the implementer's own defect). `McpStdio.launch(layer)` → `Effect<never, Error, R>` is `Layer.launch` plus self-reporting: it catches the cause, logs a real failure on stderr itself, and re-raises marked `[Runtime.errorReported] = false` so `runMain`'s own report — which runs outside anything the program provides, and writes through `console.log` when `LogToStderr` was only scoped to the launched effect — never fires a second, malformed report onto the wire. `McpStdio.teardown` maps a success or an interrupt-only exit (stdin EOF) to 0; everything else goes to `Runtime.defaultTeardown`.
- **`ToolFailure`** — a static-namespace class, never instantiated. `ToolFailure.fields` is `{ message: Schema.String, remediation: Remediation }`, spread into a consumer's `Schema.TaggedError`. `ToolFailure.message(raw, remediation)` builds `"<raw> <hint>[ Try <suggestedTool>.]"`, dropping empty parts. `ToolFailure.truncate(value, limit = ECHO_LIMIT)` caps a caller-supplied value at 200 UTF-16 code units (2000 via `ENGINE_ECHO_LIMIT` for engine-produced values like a path), backing off one unit rather than splitting a surrogate pair.
- **`ToolInputSchema`** — pure, dependency-free walkers over a *served* JSON Schema, not the source `Schema.Class`. `unknownKeys(payload, schema)` → `ReadonlyArray<UnknownKeysLevel>` (`path`, `unknown`, `accepted`) walks `$ref` (into `$defs`, JSON Pointer escapes honoured), `allOf` (properties merged), discriminated `oneOf`/`anyOf` (by an `action`/`kind`/`_tag`/`type` literal, tried in that order, or by being the lone object member), `items`/`prefixItems`, and `patternProperties`, capped at depth 256. `formatUnknownKeys(levels, options?)` renders `Unrecognized parameter(s): a, b.c. Accepted params: x, y.` per level, capped at 20 keys and 20 levels shown. `objectRooted(schema)` rewrites a top-level discriminated union of objects to an object root carrying `oneOf` and `x-discriminator` — MCP requires an object root and core dies at boot on a union one. **Only `additionalProperties: false` closes a node** — a missing value, `true`, or a schema-valued `additionalProperties` all leave it open, matching what core emits on a strict tool. **Run `unknownKeys` in a handler only for a `Tool.dynamic` tool**, against the raw JSON Schema you registered (usually `objectRooted`): core decodes a `Tool.make` tool's payload before the handler runs (`McpServer.ts:1888`), so an excess key is already dropped or rejected by then — use `McpToolkit` for those.
- **`McpToolkit`** — `McpToolkit.layer(toolkit, options?: McpToolkitOptions)` runs core's `registerToolkit` unchanged, under a registration-scoped decorated `McpServer` whose `addTool` puts an `unknownKeys` pre-check in front of each handler. Rejection stays core's — `Tool.Strict` already decodes with `onExcessProperty: "error"` — but core reports only the *first* excess key; the decorator's pre-check walks the schema the tool actually serves and fails with one `McpSchema.InvalidParams` naming every unknown key path plus the accepted params, before core ever decodes. `options.strict` is `"all"` (default) or `"annotated"`: `"all"` re-annotates every tool without its own `Tool.Strict` annotation to strict; `"annotated"` leaves annotation alone. An explicit annotation always wins in either mode, and a `Tool.dynamic` tool is never re-annotated (core dies at registration on a strict dynamic tool, since it cannot strictly validate a raw JSON Schema). Only a tool that ends up strict gets the pre-check — the same predicate core uses to pick strict decoding. `DEFAULT_STRICT = "all"` because probe P2 found Claude Code 2.1.281 never places its own protocol extras inside a call's `arguments`, only under `params._meta` — see `okf/decisions/mcp-strict-default-for-claude-code.md`. Registration goes through core's module-level `McpServer.McpServer.layer`, shared by reference with `McpStdio.layer`'s own copy — never wrap it in `Layer.fresh`.
- **`McpHarness`** (`./testing`) — `McpHarness.make(server, options?)` builds `server` over a queue-backed `Stdio.layerTest` and returns an in-process client: `initialize`/`discover`, `request`/`startRequest`/`notify`, `callTool`, `listTools`, `readResource`, `sendRaw`, `awaitOutboundMethod`, `stderrSoFar`, `consoleLogSoFar`, `close` (`Queue.end`). Pass `server` **without** its own `Stdio` — one it provides internally wins and talks to the real terminal. Responses are matched by id, so notifications interleave freely. Every wait races a stop signal and a corruption signal (`strictStdout`, default `true`, dies the wait on a non-JSON-RPC stdout line), so nothing can hang past the server stopping. On a stateful revision (the default `2025-11-25`), `yield* client.initialize` first: any other request before an `initialize` was sent fails fast with `McpTestFailure` reason `NotInitialized`, never reaching a server that would only answer `Invalid request metadata`; `sendRaw` is never gated.
- **`McpProcess`** (`./testing`) — `McpProcess.spawn(command)` spawns a real child for the current scope and returns `send`, `nextLine` (fails `StreamEnded` at stream end), `readUntilResponse(id)` (returns `{ response, seen }`, reading past interleaved notifications), `handshake(protocol?)` (**always uses id 1** — a test's own requests start at id 2 or above), `closeStdin` (`Queue.end`, never `shutdown` — an in-flight frame is delivered first), `exitCode`, `stderrSoFar`/`stderrFinal`.
- **`McpProbe`** (`./testing`) — `McpProbe.initialize(command, options?)` is the smallest proof an installed MCP bin boots: one `initialize` (or `server/discover` on a stateless revision), keeping stdin open until the id-1 response arrives, THEN closing it — closing right after writing makes an Effect server drop the in-flight response and exit 0, reading as a pass with no response. Returns `{ response, stdout, stderr, exitCode }` — assert `response.error === undefined` as well as empty `stderr` and exit 0, because a JSON-RPC error response is still a response; on a `StreamEnded` failure the exit code and stderr are folded into the `McpTestFailure` itself, since the caller holds no separate handle to read them.
- **`McpTestFailure`** (`./testing`) — the one typed failure shared by every test client: `reason: "StreamEnded" | "ServerStopped" | "NotJsonRpc" | "NotInitialized" | "ErrorResponse"`, `message`. `StreamEnded` and `NotJsonRpc` come from the spawned clients (`McpProcess`, `McpProbe`); `ServerStopped`, `NotInitialized` and `ErrorResponse` (`listTools` only) from `McpHarness`. The harness never raises `NotJsonRpc`: under `strictStdout` a non-JSON-RPC line DIES the wait, so assert it with `Effect.exit` + `Cause.hasDies`.
- **`McpToolAudit`** (`./testing`) — `McpToolAudit.check(tools, policy)` is a pure sweep over a served `tools/list`, returning `"<tool>: <what>"` per violation. **Reports a duplicate tool name under every policy**, independent of `input`/`requireTitle`/etc. `policy.input`: `"closed"` requires every object node reject unknown keys, `"open"` requires none with declared properties to, `"any"` skips the check. `requireTitle?`, `requireOutputSchema?`, `objectRootedOutput?` (defaults `true` — the stateless `2026-07-28` adapter passes a non-object output through verbatim, while the stateful revisions drop it from the served tool), `maxDescription?`, `requireHints?` (all four MCP annotation hints present as booleans).

## Usage

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

The platform `Stdio` is the one service provided at the edge: `ServerLayer` still requires it, and `Main` supplies `NodeStdio.layer` from `@effect/platform-node` just before launch. Leave that line out and `McpStdio.launch(Main)` fails to typecheck, because `Stdio` is still in its requirements. Test `ServerLayer`, never `Main`: `McpHarness.make` supplies its own queue-backed `Stdio`.

## Testing machinery

`McpHarness` is the default: no child process, no sockets, exact served schemas. Reach for `McpProcess`/`McpProbe` only when the test must exercise a **built** bin rather than a layer — proving a packed install actually boots, or that a spawned server's stdout stays clean end to end. `McpToolAudit` needs no server at all: feed it a `tools/list` result (from `McpHarness.listTools`, real traffic, or a hand-built fixture) and read the policy violations as data.

## Gotchas

- **`runMain` reports outside the program.** A bare `Layer.launch(Main).pipe(Effect.provideService(References.LogToStderr, true))` typechecks and serves, but `runMain`'s own report runs via `Effect.tapCause` outside anything the program provides — `LogToStderr` is already back to its default by the time that tap fires, so a launch failure still prints through `console.log`, onto the JSON-RPC wire. Use `McpStdio.launch`, which reports the failure itself.
- **A declared failure is message text only.** Core sends a tool's declared failure — an `Error` instance, which every `Schema.TaggedError` is — as `isError: true` with `error.message` as the only text and no `structuredContent`. Whatever is not folded into `message` at construction never reaches the agent; that is the whole reason `ToolFailure` exists.
- **`InvalidParams` differs per protocol revision.** On `2024-11-05`, `2025-03-26` and `2025-06-18` it is a JSON-RPC error, code `-32602`. On `2025-11-25` and the stateless `2026-07-28` it is an `isError: true` tool result. A test that only checks one shape misses the other half of the matrix.
- **A top-level union parameter dies at boot.** `Tool.make`'s `parameters` must resolve to an object schema for MCP's tool-JSON encoding; a top-level `Schema.Union` of objects is decoded with `orDie` and kills the server at registration. Design the tool with an object-rooted, discriminated-by-field shape from the start; when the union is raw JSON Schema, rewrite it with `ToolInputSchema.objectRooted` and register it as a `Tool.dynamic` tool, which is how a rewritten schema reaches a server.
- **`Tool.EmptyParams`, not `Schema.Struct({})`.** A tool with no arguments uses core's own empty-parameters marker; an empty `Schema.Struct({})` is a different, non-canonical shape that some clients' schema validators reject.
- **`dependencies` is required.** A tool handler that reaches for a service must declare it in `Tool.make`'s `dependencies` option — a handler that pulls an undeclared service either fails to compile against the toolkit's inferred `R`, or (worse) silently resolves an ambient default nobody wired. Declare every service a handler touches.
