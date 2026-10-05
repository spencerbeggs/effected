---
type: Module
title: "@effected/lsp"
description: Language Server Protocol base-protocol framing as pure functions (Content-Length encode, an incremental byte decoder and a Stream transform), an LspStdio launcher that keeps stdout the wire and exits with the specification's code, plus a ./testing subpath whose LspProbe proves a Language Server bin boots and whose LspProcess drives one frame by frame — the LSP twins of McpStdio, McpProbe and McpProcess.
status: draft
kind: package
resource: ../../packages/lsp
layer: boundary
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-10-05T19:06:35Z
  body_sha256: 2e1904869a50639a9b7337cdce2e97371b655a41b04afaac05a0054e754240d1
---

# @effected/lsp

`@effected/lsp` exists because a consumer ships a Language Server bin and
has no kit tool to prove it boots after a packed install. okfit's
`okfit-lsp` is a `vscode-languageserver` server over stdio — not an
Effect program — and its packed-install test hand-rolls the
Content-Length frames for `initialize` / `initialized` / `shutdown` /
`exit` and then string-matches the collected stdout (okfit carrier-friction
request, item 7). The MCP half of the same test is one call,
`McpProbe.initialize`; this package gives the LSP half the same shape.

It is **not** an LSP server framework. Serving the protocol stays with
whatever the consumer serves it with; the kit owns the wire framing, the
stdio launch around a server the consumer wrote, and the test clients.
The launcher and `LspProcess` came from okfit's first adoption round
(carrier-friction findings, round 1): its `main.ts` hand-wrote the
stdout-trap workaround, the exit-code mapping and an explicit process
exit, and its e2e suite hand-wrote a Content-Length client with a frame
hygiene check.

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md). The main entry does no IO
of its own: `LspFrame` is pure, and `LspStdio` returns an Effect for the
caller's `runMain` and a `Runtime.Teardown`, taking the process as a
structural `LspExitHost` parameter rather than reading it; `./testing` does IO only through core's
`ChildProcessSpawner`, required in `R`. `effect` is the only peer and the
only runtime import: no `@effected/*` edge, no `node:` import and no
`process` read in `src/`, pinned by `__test__/boundary.test.ts` over
`SourceBoundary.scan` (`@effected/workspaces/testing` is a
devDependency for that test alone).

**Nothing in the kit may depend on this package except an application.**
It is a front-end sibling of [`@effected/mcp`](mcp.md) and
[`@effected/cli`](cli.md): no edge between any two of them, and no
library takes an edge on any of them. It does **not** depend on
`@effected/engine`, and it builds no process guard — the
transport-neutral guard belongs to `@effected/engine`'s `./guard`, built
separately.

## Public surface

### `@effected/lsp`

| Export | Contract |
| --- | --- |
| `LspFrame.encode` | `(message: unknown) => Uint8Array`. `Content-Length: N\r\n\r\n<body>` where the body is the message's JSON text and `N` is its UTF-8 **byte** length, never its UTF-16 length. A value JSON cannot encode is a caller bug and throws. |
| `LspFrame.decodeResult` | `(bytes: Uint8Array, offset?: number) => Result<LspFrameDecoded, LspFrameError>`. The incremental primitive: every complete frame at the front of `bytes` is decoded, and the bytes of an incomplete trailing frame come back as `rest` for the caller to prepend to the next chunk. A chunk may split a header, a body, or a multi-byte character, and may hold several frames. `offset` is the stream position of `bytes[0]`, so an error names a stream position. |
| `LspFrame.decode` | The `Effect` form of `decodeResult` behind the `LspFrame.decode` span. |
| `LspFrame.decodeAllResult` / `decodeAll` | A complete buffer (`Uint8Array` or `string`, UTF-8 encoded first) to its messages; leftover bytes fail `Truncated`. For a collected stdout. |
| `LspFrame.decodeStream` | `Stream<Uint8Array, E, R> => Stream<unknown, E \| LspFrameError, R>`, threading `rest` and the stream offset across chunks; a stream that ends inside a frame fails `Truncated`. |
| `LspFrameError` | `Schema.TaggedError`: `code` (`MissingContentLength`, `InvalidContentLength`, `InvalidHeader`, `HeaderTooLarge`, `InvalidBody`, `Truncated`), `offset` (stream position of the frame's first byte) and an optional `cause` (the JSON or UTF-8 failure, as a defect value); `message` is a getter over them. |
| `LspMessage` | The JSON-RPC 2.0 message shape a frame body carries (type only). |
| `LspStdio.launch` | `<E, R>(program: Effect<LspSessionEnd, E, R>) => Effect<0 \| 1, Error, R>`. Provides `LogToStderr` to the whole program, maps its `LspSessionEnd` through `exitCode`, and reports any non-interrupt failure on stderr itself, re-raising it marked `Runtime.errorReported = false` with its original `Runtime.errorExitCode`. |
| `LspStdio.exitCode` | `(end: LspSessionEnd) => 0 \| 1`. 1 only when `exit` arrived without a prior `shutdown`; a stdin close (`"closed"`) is 0. |
| `LspStdio.teardown` | `(host: LspExitHost) => Runtime.Teardown`. A numeric success is the code (any other success 0), an interrupt-only exit is 0, anything else goes to `Runtime.defaultTeardown`; then `host.exit(code)`. |
| `LspSessionEnd` | `{ reason: "exit" \| "closed"; shutdownReceived: boolean }`, returned by the server's own message loop. |
| `LspExitHost` | `{ exit: (code: number) => void }`; Node's `process` satisfies it. |

Decoding rules: header fields end `\r\n`, the header ends `\r\n\r\n`,
names are case-insensitive, `Content-Length` must be one decimal safe
integer, unknown fields (`Content-Type`) are ignored, and a header longer
than 8 KiB without its terminator fails `HeaderTooLarge` rather than
buffering without bound. The body must be valid UTF-8 and valid JSON.

### `@effected/lsp/testing`

| Export | Contract |
| --- | --- |
| `LspProbe.initialize` | `(command: ChildProcess.Command, options?: LspProbeOptions) => Effect<LspProbeResult, LspTestFailure \| PlatformError, ChildProcessSpawner>`. Spawns the bin and runs the whole lifecycle: `initialize` (id 1) → its response → `initialized` → `shutdown` (id 2) → its response → `exit`, then waits for the exit code with stdin still open. |
| `LspProbeOptions` | `rootUri` and `processId` (default `null`), `capabilities` (default `{}`), `initializationOptions` (omitted unless given), `timeout` (default 30 seconds, over the whole exchange). |
| `LspProbeResult` | `response` (id 1, an error response included), `shutdown` (id 2), `messages` (every frame the server sent, in order), `stderr`, `exitCode`. |
| `LspProcess.spawn` | `(command: ChildProcess.Command) => Effect<LspProcess, PlatformError, ChildProcessSpawner \| Scope>`. A child for the life of the scope. Instances: `send` (one `LspFrame.encode` frame), `sendRaw` (bytes as given), `nextMessage` and `readUntilResponse(id)` (`{ response, seen }`), `closeStdin` (`Queue.end`), `exitCode`, `stderrSoFar`, `stderrUntil(predicate, { timeout })`, `stderrFinal`, `stdoutSoFar` and `stdoutFinal` (raw bytes), `assertOnlyFrames`. |
| `LspProcess.assertOnlyFrames` | Waits for stdout to end, then `LspFrame.decodeAllResult` over the raw capture: a stray byte before, between or after the frames, or a stream ending inside one, fails `InvalidFrame` with the offset and an excerpt; a body that is no JSON-RPC message fails `NotJsonRpc`. Returns every message. |
| `LspProcessStderrUntilOptions` | `timeout`, real time. |
| `LspTestFailure` | `Schema.TaggedError` with `reason` (`StreamEnded`, `InvalidFrame`, `NotJsonRpc`, `TimedOut`) and `message`, mirroring `McpTestFailure`. |

## Load-bearing decisions

- **`LspStdio.launch` reports a failure itself, on stderr.** `runMain`
  logs an unhandled failure via `Effect.tapCause` on the outermost fiber,
  outside every `Effect.provide` the program applies, so a `LogToStderr`
  provided inside never reaches it, and Effect's default logger writes
  through `console.log` — the wire. okfit hit it as a missing `HOME`
  failing a platform layer. `launch` catches the cause inside its own
  `LogToStderr` provision, logs it, and fails with an internal
  `LaunchFailed` marked `Runtime.errorReported = false`, the
  `McpStdio.launch` shape. `runMain`'s `disableErrorReporting` would also
  silence the leak, but only in a consumer that remembers to pass it; the
  marker travels with the failure.
- **The shutdown/exit state lives in the server's message loop.** The kit
  owns no loop, so it cannot observe `shutdown` or `exit`. The program
  returns an `LspSessionEnd` and `LspStdio.exitCode` applies the
  specification's rule. okfit's own transport already reports exactly
  this shape (`ListenOutcome`).
- **`LspStdio.teardown` always ends the process through its host.**
  `runMain` exits the process itself only for a non-zero code or a
  signal, and leaves code 0 to the event loop draining. A server reading
  stdin through `NodeStdio` never drains while stdin is open, and after
  `exit` stdin is still open: probed, a clean `shutdown` then `exit` sat
  until the client closed the pipe. okfit met the same hang through
  `vscode-languageserver`'s `--clientProcessId` liveness interval. There is
  deliberately no drain-only teardown; `LspStdio.test.ts` pins the hang
  with a no-op host as the control. The process arrives as a structural
  parameter, so `src/` still never reads it.
- **One stdout reader.** `LspProbe` runs on the same internal machinery as
  `LspProcess`, with an option that folds the exit code and the whole
  stderr into `StreamEnded` (safe only under the probe's own timeout). The
  raw capture sits ahead of the decoder, so `assertOnlyFrames` checks
  every byte even after a frame error stopped decoding.

- **The probe sends `initialized`.** The LSP specification requires the
  client to send it after the `initialize` result and before any other
  request or notification, `shutdown` included. A server is entitled to
  refuse anything sent before it, so a probe that skipped it would test a
  sequence no editor sends. It is skipped only when `initialize` answered
  with an error.
- **Stdin stays open after `exit`.** The specification makes the server
  terminate itself on `exit`; the client is not required to close the
  pipe. A probe that closed stdin would pass a server that ignores `exit`
  and only stops at EOF — which an editor never triggers, so that server
  hangs in the field. Such a server fails the probe's `TimedOut` instead.
- **Exit code 0 means `shutdown` preceded `exit`.** The specification's
  own rule (1 when `exit` arrives without `shutdown`); the caller asserts
  `exitCode === 0`, `response.error === undefined` and an empty `stderr`.
- **Server requests are recorded, never answered.** A server may send
  `client/registerCapability` or `window/workDoneProgress/create` during
  the lifecycle; the probe leaves them in `messages` and answers nothing,
  because no answer is right for every method and a boot proof does not
  need one.
- **Never hangs.** Every wait reads a queue the stdout reader ends or
  fails, and the whole exchange sits under one timeout whose failure names
  the step it was waiting on and the stderr so far. Closing the probe's
  scope kills the child.
- **The `./testing` split mirrors `@effected/mcp`.** Test tooling never
  enters a runtime graph; `entrypoints.test.ts` pins that nothing
  reachable from `.` imports the probe, with a positive control.

## See also

- [`@effected/mcp`](mcp.md) — `McpStdio`, `McpProbe` and `McpProcess`,
  the MCP halves of the same surfaces.
- [Add a kit package](../runbooks/add-a-kit-package.md)
