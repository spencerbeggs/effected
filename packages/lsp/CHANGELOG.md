# @effected/lsp

## 0.1.0

### Features

#### Base-protocol framing

- `LspFrame` encodes and decodes Content-Length framed Language Server Protocol messages: `LspFrame.encode`, `LspFrame.decode` and `LspFrame.decodeStream`. Malformed frames fail with `LspFrameError`.

#### Stdio launcher for an Effect language server

- `LspStdio` is the `main.ts` of an Effect language server over stdio:

```ts
NodeRuntime.runMain(LspStdio.launch(serve), { teardown: LspStdio.teardown(process) })
```

- `LspStdio.launch` reports a failed server on stderr. Without it, `runMain` writes the report to stdout, the protocol wire, even when the program provides `LogToStderr`.
- `LspStdio.exitCode` applies the specification's rule to the `LspSessionEnd` your message loop returns: `exit` without a prior `shutdown` exits 1.
- `LspStdio.teardown` ends the process on `exit`. Otherwise a server whose stdin is still open never exits on its own.

#### Test clients for a language server bin

- The `@effected/lsp/testing` entry exports:

- `LspProbe.initialize`, which drives a server bin through `initialize`, `initialized`, `shutdown` and `exit` to prove it boots and exits cleanly.

- `LspProcess.spawn`, which drives a server bin message by message: `send`, `readUntilResponse`, `stderrUntil` for a report that lands later, and `assertOnlyFrames`, which proves stdout carried nothing but well-formed frames.

- Failures are reported as `LspTestFailure`. [#944][#944]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#944]: https://github.com/spencerbeggs/effected/pull/944
