---
"@effected/lsp": minor
---

## Features

### Base-protocol framing

`LspFrame` encodes and decodes Content-Length framed Language Server Protocol messages: `LspFrame.encode`, `LspFrame.decode` and `LspFrame.decodeStream`. Malformed frames fail with `LspFrameError`.

### Boot proof for a language server

The `@effected/lsp/testing` entry exports `LspProbe.initialize`, which drives a server bin through `initialize`, `initialized`, `shutdown` and `exit` to prove it boots and exits cleanly. Failures are reported as `LspTestFailure`.
