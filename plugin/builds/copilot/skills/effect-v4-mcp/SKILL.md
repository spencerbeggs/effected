---
name: effect-v4-mcp
description: "Use when building, wiring, testing or reviewing an MCP server on Effect v4 — effect/ai's McpServer, Tool and Toolkit plus the @effected/mcp-kit boundary that keeps stdout the JSON-RPC wire and makes tool failures readable to an agent. Also use when: MCP server, McpServer, Tool.make, Toolkit, layerStdio, tools/call, server/discover, initialize, Tool.Strict, unknown keys, isError, structuredContent, InvalidParams, MCP resource, mimeType, stdio server exits 130, JSON-RPC on stdout, McpHarness, McpProbe, crash guard, ok false envelope, ToolOutcome, idempotency key, ToolReplay, StdioCapture, library writes to stdout, Exclusive, ProcessScope, chdir per request"
---

# Effect v4 MCP servers

Core owns the protocol, tool registration and the wire format:
`effect/ai`'s `McpServer`, `Tool` and `Toolkit` parse requests,
serve JSON Schema, and shape a `tools/call` result. `@effected/mcp-kit` owns the
stdio boundary — keeping every log line and every crash report off stdout,
which is the JSON-RPC wire — plus tool-failure shaping and strict-by-default
registration. `@effected/mcp-kit/testing` owns the in-process and spawned test
clients.

**Look it up first.** Before you hand-write stdout handling, a tool-error
shape, a crash handler or a test client, grep the kit:
`grep -i "<intent words>" "<skill base directory>/../effected-packages/references/constructs/mcp-kit.md" "<skill base directory>/../effected-packages/references/constructs/kit.md"`.
Confirm a core name in `$EFFECT_SRC/ai/McpServer.ts` or `Tool.ts`
([effect-v4-source-lookup](../effect-v4-source-lookup/SKILL.md)) before you
call it. A server that shares its logic with a CLI follows the carrier pattern
in [design-patterns](../design-patterns/SKILL.md).

| construct | import | reach for it when |
| --- | --- | --- |
| `McpServer`, `Tool`, `Toolkit`, `McpSchema` | `effect/ai` | declaring the server, its tools, and the protocol-level schemas |
| `McpStdio` | `@effected/mcp-kit` | launching a stdio server without a stray log line or crash report reaching the wire |
| `McpToolkit` | `@effected/mcp-kit` | registering a toolkit strict-by-default; core's strict decode names every bad key and field in one response, and the layer appends each offending level's accepted params |
| `ToolFailure` | `@effected/mcp-kit` | folding remediation into a declared failure's message — core sends only `error.message` |
| `ToolInputSchema` | `@effected/mcp-kit` | naming unknown keys in a `Tool.dynamic` tool's raw payload, inside its own handler — core never validates a raw JSON Schema |
| `McpToolkit.unionTool` / `unionHandler` | `@effected/mcp-kit` | a tool whose parameters are a `Schema.Union` of objects, rejected like a `Tool.make` decode failure |
| `ToolOutcome` | `@effected/mcp-kit` | an expected domain error the agent should branch on as data: the `ok: false` envelope on the success channel, where `structuredContent` arrives |
| `ToolReplay` | `@effected/mcp-kit` | a write tool whose retried call with the same idempotency key returns the first result instead of running again |
| `StdioCapture` | `@effected/mcp-kit/node` | an in-process library (a test runner, a bundler) that writes to stdout from inside a handler |
| `Exclusive` | `@effected/kit` | handlers that mutate process-global state (cwd, env, a patched stream) must run one at a time, under a timeout |
| `ProcessScope` | `@effected/kit` | a `chdir` or an env patch restored when the request's scope closes |
| `McpGuard` | `@effected/mcp-kit/guard` | crash guards installed before the server graph loads, with an exit-before-connect policy |
| `ProcessGuard` | `@effected/kit/guard` | the same guards for a server on another transport (an LSP), which reports `markConnected` itself |
| `Remediation`, `LaunchContext` | `@effected/kit` | a structured `{ hint, suggestedTool? }` shape, or resolving an agent-launched project directory |
| `McpHarness`, `McpProcess`, `McpProbe`, `McpToolAudit` | `@effected/mcp-kit/testing` | testing the server layer in process, a spawned child, a packed install, or auditing what `tools/list` actually serves |

## Standards

- Launch with `McpStdio.launch` and `NodeRuntime.runMain(program, { teardown: McpStdio.teardown })` — never a bare `Layer.launch`.
- Register toolkits through `McpToolkit.layer`, not core's `McpServer.toolkit` directly, so every tool is strict unless it opts out.
- Fold remediation into a declared failure's message with `ToolFailure` at construction — nothing else reaches the agent.
- Capture a service a handler needs for the server's lifetime in the effect form of `Toolkit.toLayer`; declare a service in `Tool.make`'s `dependencies` only when it varies per request, and meet it with `McpServer.middleware`, or, when a declared service is fixed for the server's lifetime, with `McpToolkit.provideLifetime` — `Layer.provide` cannot — load [Defining a tool](./references/tools.md#defining-a-tool) before you wire a handler's services.
- Pass the toolkit layer to `McpStdio.layer` as `registrations`, so it builds before the first request with its logs on stderr.
- Return an expected error the agent branches on through `ToolOutcome.catchAsEnvelope`, written inline in the handler's `pipe`.
- Test the server layer in process with `McpHarness`; test a **built** bin with `McpProcess`/`McpProbe`.

## Footguns

- Hand-wiring `McpServer.layerStdio` without `McpStdio.layer` leaves a malformed line unanswered — core skips it silently where JSON-RPC requires a `-32700`/`-32600` reply — load [The stdin guard](./references/server-wiring.md#stdin-guard) before you wire stdio by hand.
- Two stdio servers in one process share one tool registry unless each **whole** bundle (toolkit + server) is wrapped in `Layer.fresh`: merged or nested without it, each lists both servers' tools; `Layer.fresh` around the server alone, toolkit outside, serves no tools — load [`McpStdio.layer`](./references/server-wiring.md#mcpstdiolayer) before you run two servers in one process.
- On a serverless host such as Cloudflare Workers, `McpServer.layerHttp` keeps a long-lived server whose fibers and timers outlive the request; serve with `McpServer.layerHttpRequestScoped` instead, which builds one server per POST. Its `protocols` take only sessionless adapters (`McpProtocol.v2026_07_28`) — the type rejects a sessionful one, and the layer fails with `IllegalArgumentError` if one gets through — and it has no subscription or session-termination options.
- `runMain`'s own failure report runs outside anything the program provides and lands on stdout, the wire — load [`McpStdio.launch`](./references/server-wiring.md) before you assemble `main.ts`.
- Stdin EOF ends the server with exit `0`, even under the default teardown; SIGINT and SIGTERM still exit `130` there — load [`McpStdio.teardown`](./references/server-wiring.md) before you rely on an exit code.
- A declared failure reaches the agent as message text only, never `structuredContent`, under either failure mode, so `ToolRefusal.refuse` takes no data argument — load [Failures on the wire](./references/tools.md#failures-on-the-wire) before you design a tool's failure.
- `injectCrash: { at: "connected" }` reports on a later tick, after the first responses a test may read; wait with `McpProcess.stderrUntil`, never one `stderrSoFar` read — load [`McpGuard.run`](./references/server-wiring.md#mcpguardrun-packages-both-policies) before you assert on an injected crash.
- `InvalidParams` moves to an `isError` tool result on the newer protocol revisions only for a known tool's own bad parameters — an unknown tool or non-object `arguments` stays a JSON-RPC error on every revision — load [Failures on the wire](./references/tools.md#failures-on-the-wire) before you handle bad parameters.
- A top-level union `parameters` schema dies the server at registration, not at the first call — use `McpToolkit.unionTool` — load [Failures on the wire](./references/tools.md#failures-on-the-wire) before you give a tool union parameters.
- A pattern-keyed `Schema.Record` parameter is served open unless its key RegExp has the `u` flag, while core still rejects a non-matching key — load [Strict input](./references/tools.md#strict-input) before you key a parameter record by pattern.
- A `Schema.String` success is sent as raw text with no `structuredContent` on the stateful revisions, and as JSON-quoted text plus a string `structuredContent` on `2026-07-28` — load [Failures on the wire](./references/tools.md#failures-on-the-wire) before you return a bare string.
- `ToolOutcome.catchAsEnvelope` bound to a `const` before it is applied loses the piped effect's error type, so a misspelled tag compiles and never matches — load [The `ok: false` envelope](./references/tools.md#the-ok-false-envelope) before you bind an envelope helper.
- A `ToolReplay` key reused with different params replays the first call's result — it compares nothing but the key, and rows never expire — and two concurrent calls with one key both run: it is replay, not exactly-once — load [Idempotent replay](./references/tools.md#idempotent-replay) before you add an idempotency key.
- `ToolReplay.success` drops the struct's own `.check(...)` refinements; apply checks to its result — load [Idempotent replay](./references/tools.md#idempotent-replay) before you trust a replayed result's checks.
- `StdioCapture` leaks both ways: a callback registered outside the capture (a child-pipe listener, relayed worker output) still writes to the wire, and a fiber forked inside it keeps writing to the sink after it ends — load [Keeping a library's output off the wire](./references/tools.md#keeping-a-librarys-output-off-the-wire) before you run a library that writes to stdout.
- `Exclusive.run` is not reentrant: a nested `run` on the same lane waits on its own caller's permit and fails as the outer `ExclusiveTimeout`. `Effect.promise` inside a lane abandons the promise on timeout; use `Exclusive.promise`, and `abandon: true` for a promise that ignores its signal. A boundary test can hold the line: `SourceBoundary.scan({ root, rules: [{ promiseInExclusive: {} }] })` from `@effected/workspaces/testing` flags either call lexically inside a `lane.run(` body (pass `lanes` for a lane received as a parameter; a helper called from the body is not seen).
- `Schema.Struct({})` is not `Tool.EmptyParams` — it fails server registration outright — load [Defining a tool](./references/tools.md#defining-a-tool) before you declare a tool with no parameters.
- Closing stdin does not cancel requests in flight: the server answers them, then stops — so `McpHarness.close` never releases a wait on a request that never completes; `McpHarness.stop` does — load [`McpStdio.teardown`](./references/server-wiring.md) before you rely on stdin close to cancel work.
- A resource read carries its registered `mimeType` for every `content` form, a bare string or bytes included; a full `ReadResourceResult` is sent as written — load [The `mimeType` on a read](./references/resources.md#the-mimetype-on-a-read) before you serve a resource.
- A resource URI template variable cannot span a slash — an id containing one needs a static resource per id, not a template — load [A template variable cannot span a slash](./references/resources.md#a-template-variable-cannot-span-a-slash) before you put an id in a resource template.
- An `Effect.timeout` guard inside `it.effect` never fires — `TestClock` never advances on its own, so the test hangs until vitest's own default timeout kills it instead. Use `it.live` or a real-clock `layer(...)` — load [Timeouts](./references/testing.md#timeouts) before you test a timeout.
- Code placed after a completed `Effect.provide` of a stdio server never runs — core's stdio protocol interrupts the fiber that built it once the server stops, so a hand-written test provides-then-asserts and silently checks nothing. Use `McpHarness` — load [The in-process harness](./references/testing.md#the-in-process-harness) before you write code after providing a server.

## Additional resources

- [server-wiring.md](./references/server-wiring.md) — the complete `main.ts`, `McpStdio.layer`/`launch`/`teardown`, protocol ordering, crash guards, and launch-context project-directory resolution. Load when: assembling or reviewing a server's `main.ts`, or debugging why a failure or a log line reached the wire.
- [tools.md](./references/tools.md) — defining a tool, strict input reporting, failures on the wire, the `ToolOutcome` `ok: false` envelope, `ToolReplay` idempotent replay, and `StdioCapture`. Load when: declaring a `Tool.make`, wiring a `Toolkit`, a client is seeing the wrong failure shape, a write tool needs an idempotency key, or a handler runs a library that writes to stdout.
- [resources.md](./references/resources.md) — `McpServer.resource`'s single and URI-template forms, the `mimeType` a read carries, and why a slash-containing id needs a static resource instead of a template. Load when: registering an MCP resource, or a client's read is missing a `mimeType` it expects.
- [testing.md](./references/testing.md) — the in-process harness, the protocol matrix, spawned clients, the packed-install proof, and the tool audit. Load when: writing a test against an MCP server, or choosing between `McpHarness`, `McpProcess`, `McpProbe` and `McpToolAudit`.
- `effected-packages`' [mcp-kit.md](../effected-packages/references/mcp-kit.md) — the `@effected/mcp-kit` package surface as a routing reference (import table, full API, Usage block). Load when: you need the package-level index rather than the teaching depth here.

Anchors in this skill and its references cite the vendored tag at
`.repos/effect/packages/effect/src/`; a consumer without that tree searches
`node_modules/effect/src` by symbol name instead of by line number.
