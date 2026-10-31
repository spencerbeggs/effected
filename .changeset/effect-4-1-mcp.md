---
"@effected/mcp": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### Registrations go through McpStdio.layer

`McpStdioOptions` takes `registrations`, a layer of your toolkit and handlers, so they build before the first request with build-time logs on stderr:

```ts
McpStdio.layer({ registrations: McpToolkit.layer(Kit).pipe(Layer.provide(Handlers)) })
```

- `McpStdio.layer` no longer outputs `McpServerClient`; read `McpSchema.McpRequestContext` instead.
- Only `IllegalArgumentError` (such as a bad `protocols` list) still dies; a registration's typed errors stay in the error channel.
- `McpToolkit.layer` requires `McpRequest<"Requires", S>` for every service a tool declares in `dependencies`, and `Layer.provide(Layer.succeed(S, …))` no longer satisfies it. Provide a per-request value through `McpServer` middleware, or drop it from `dependencies` and capture it in the effect form of `toLayer`.
- `ToolReplay` takes a `store`: read `KeyValueStore` when the handler is built and pass it in. A `KeyValueStore.makeStringOnly` store must implement `keys`.
- A toolkit merged beside the transport needs `Layer.provide(McpServer.McpServer.layer)`; prefer `registrations`.
- A union tool with no `success` schema now answers `tools/call` with `content: []` where it was an internal error.
