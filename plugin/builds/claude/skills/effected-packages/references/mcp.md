# @effected/mcp

The `effected-mcp` server: a front end of the `effected` tool, on `effect/ai` and
`@effected/mcp-kit`. Application package, no library tier. A consumer installs
`@effected/plugin`, not this package. (The MCP boundary library is
`@effected/mcp-kit`.)

## Import

```ts
import { MCP_VERSION, main } from "@effected/mcp";
import { main } from "@effected/mcp/main";
```

## Core API

- **`main(options?)`** — runs the server over stdio and owns the process, under
  `McpGuard.run` with a lazy load so a failure while the server graph evaluates
  is still reported on stderr. `options.distribution` names the carrier the bin
  was installed through.
- **The `identity` tool** — the one tool: the tool name, this front end's
  version, the carrier `distribution` (or `null`), and the resolved `effect`
  version, as a real tool result.
- **`MCP_VERSION`** — this package's own version, replaced at build.

Stdout is the JSON-RPC wire; nothing here writes to it. The `effected-mcp` bin is
declared here and again by `@effected/plugin`. Shared logic belongs in
`@effected/engine`; tests drive the server through `McpHarness` from
`@effected/mcp-kit/testing`.
