---
id: "0034"
title: McpStdio.layer takes registrations and no longer outputs McpServerClient
kind: breaking
shows: typed
applies:
  "@effected/mcp": ">=0.12.0"
detect: ["McpStdio\\.layer", "McpServerClient", "McpToolkit\\.layer", "dependencies: *\\[", "ToolReplay"]
---

`@effected/mcp` follows core's new registration model (entry 0008).

- **`McpStdioOptions` takes `registrations`**: a `Layer` of your toolkit and handlers. Its type parameters default to `never`, so an existing `Pick<McpStdioOptions, ...>` still compiles. Pass your toolkit layer here rather than merging it beside the transport; registrations then build before the first request, with build-time logs on stderr. `McpStdio.layer({ registrations: McpToolkit.layer(Kit).pipe(Layer.provide(Handlers)) })` is a `Layer<McpServer, never, Stdio>`.
- **`McpStdio.layer` no longer outputs `McpServerClient`.** Core provides it only when every protocol is stateful, and the default protocol list includes a stateless protocol. Read `McpSchema.McpRequestContext` instead.
- **A registration's typed errors stay in the error channel.** Only `IllegalArgumentError`, such as a bad `protocols` list, still dies.
- **`McpToolkit.layer` requires `McpRequest<"Requires", S>` for every service a tool declares in `dependencies`**, and `Layer.provide(Layer.succeed(S, …))` no longer satisfies it. Two migrations:
  - **A per-request value:** provide it through `McpServer` middleware, `McpServer.middleware<{ provides: S }>()((effect) => Effect.provideService(effect, S, value))`, and `Layer.provide` its `.layer` on the toolkit layer.
  - **A value fixed at build:** drop it from `dependencies` and capture it in the effect form, `Kit.toLayer(Effect.gen(function* () { const s = yield* S; return { ... } }))`.
- **A toolkit merged beside the transport** with `Layer.mergeAll` now needs `Layer.provide(McpServer.McpServer.layer)`. Prefer `registrations`.
- **`ToolReplay`:** inside a server, read `KeyValueStore` when the handler is built and pass it as `store`, or `wrap`'s `KeyValueStore` requirement becomes a declared request-level dependency. A `KeyValueStore.makeStringOnly` store must implement `keys` (entry 0009).

How it shows itself: compile errors on `McpServerClient`, on an unmet `McpRequest` requirement, or on a missing `McpServer`. Check against the installed `@effected/mcp` `.d.ts`.
