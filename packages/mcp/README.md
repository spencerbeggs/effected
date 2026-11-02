# @effected/mcp

The `effected-mcp` server: the tool's MCP tools on the kit's MCP boundary (`@effected/mcp-kit`).

This release serves one tool, `identity`, which returns what the tool reports about itself: `tool`, `version`, `distribution` (the carrier it was launched through, or `null`) and `effect`.

```ts
import { main } from "@effected/mcp/main";

await main({ distribution: { name: "@effected/plugin", version: "1.0.0" } });
```

> **Pre-`1.0.0`.** Part of the `@effected/*` kit; unstable across `0.x` releases. Pin an exact version.
