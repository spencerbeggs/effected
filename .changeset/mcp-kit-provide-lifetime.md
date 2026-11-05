---
"@effected/mcp-kit": minor
---

## Features

* `McpToolkit.provideLifetime(layer)` meets the request-level dependencies a tool declares from a layer built once for the server's lifetime (#1190). It builds in the server graph's memo map, so a failure fails the server build rather than a request and finalizers run at shutdown. It captures only what the layer outputs, so a key the build merely ran under never shadows the request's own.

```ts
const Lifetime = McpToolkit.provideLifetime(InspectorLive);
const ToolsLayer = McpToolkit.layer(Kit).pipe(Layer.provide(Lifetime), Layer.provide(KitHandlers));
```

## Documentation

* `ToolReplay.wrap` TSDoc is clarified.
