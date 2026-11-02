# @effected/mcp

The `effected-mcp` server. `src/tools/identity.ts` is the one tool; `src/server.ts` assembles `ServerLayer(options)` on `McpStdio.layer`; `src/main.ts` runs it under `McpGuard.run` with a lazy `load` (no static runtime imports, `exitBeforeConnect` for both events); `src/bin.ts` calls `main()` with no distribution; `src/version.ts` holds `MCP_VERSION`, which the bundler replaces at build.

- The `effected-mcp` bin name is shared with a carrier package, which passes its own `distribution` to `main`.
- Stdout is the JSON-RPC wire: nothing in this package writes to it.
- Shared logic belongs in `@effected/engine`, not here. Tests live in `__test__/` and drive the server in-process through `McpHarness` from `@effected/mcp-kit/testing`.
