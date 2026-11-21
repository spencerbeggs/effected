---
"@effected/mcp-kit": patch
---

## Documentation

* `McpStdio.layer` states which malformed stdin lines core itself answers (a line that is not JSON gets `-32700`) and which only the stdin guard does, and that the guard answers every one before core sees it, so none is answered twice
