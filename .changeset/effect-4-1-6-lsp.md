---
"@effected/lsp": patch
---

## Documentation

* `LspStdio.teardown` explains why it still ends the process itself: `NodeStdio` releases stdin once its last reader stops, but any handle the server does not own (a `--clientProcessId` liveness interval, a raw `process.stdin` listener) keeps a code-0 exit from ever draining
