---
"@effected/mcp": minor
---

## Bug Fixes

* `McpHarness` records captured console arguments the way the console shows them: an `Error` argument becomes `Error: boom` through `ErrorText`, a plain object or array renders as JSON, and anything else falls back to a description. Assertions that matched an `Error`'s bare message must now match the `Error:` prefix.
