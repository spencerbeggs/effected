---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Documentation

- `effect-v4-mcp` and the `effected-packages` MCP reference now say which refusal a request sent before `initialize` gets: `-32602 Invalid request metadata` when a stateless adapter is listed first, `-32603 Internal error` when only stateful revisions are served.
