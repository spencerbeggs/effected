---
"@effected/mcp-kit": patch
---

## Documentation

- `McpStdio.teardown`'s documentation now says why it is still needed: core ends a stdio server at stdin EOF with exit code 0 itself, and the teardown maps the unannotated interrupt that SIGINT and SIGTERM raise to 0 instead of the 130 the default teardown reports.
