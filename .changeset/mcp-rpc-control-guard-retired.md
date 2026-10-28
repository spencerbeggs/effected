---
"@effected/mcp": patch
---

## Maintenance

- `McpStdio.layer`'s stdin guard no longer intercepts lines whose `method` starts with `@effect/rpc/`. Core serves MCP with Effect's RPC control messages turned off, so such a notification is ignored and such a request is answered by core with `-32601` (`Method not found: @effect/rpc/Eof`) instead of the guard's `Method not found`. The server keeps serving either way.
