---
"@effected/claude-code-plugin": minor
---

## Features

- The `design-patterns` skill's carrier references now teach both bin
  postures: carrier-only bins (recommended, the default) and shared bins,
  with the provenance cost of sharing spelled out and the verification
  primitives (`InstalledConsumer.binProvenance`, `runCarrierBin`) to prove a
  carrier's own shim still works under either.
- The plugin-loader reference now teaches the `npx -p` major-pinned fallback
  routed through the carrier package, replacing the old mirror-bin framing.
- The `effect-v4-mcp` skill now teaches `McpToolkit.unionTool` /
  `unionHandler` and the `@effected/mcp/guard` entrypoint's crash-guard
  policy, and corrects the stdio isolation guidance: two servers in one
  process need their **whole** bundle — toolkit layers together with
  `McpStdio.layer` — wrapped in `Layer.fresh`, not the server layer alone.
