# @effected/lsp

Language Server Protocol base-protocol framing as pure functions, a stdio
launcher (`LspStdio`) that keeps stdout the wire and exits with the
specification's code, plus a `./testing` subpath whose `LspProbe` proves a
Language Server bin boots and whose `LspProcess` drives one frame by frame —
the LSP twins of `@effected/mcp`'s `McpStdio`, `McpProbe` and `McpProcess`.
Not an LSP server framework: the message loop and every handler stay with
whatever the consumer serves the protocol with (okfit's `okfit-lsp` runs
`vscode-languageserver` behind its own Effect transport).

**Design doc:** `@./okf/modules/lsp.md` — Load when: changing the public
surface, the framing rules, or the probe's lifecycle sequence.
`okf/modules/lsp.md` stays `status: draft` until the user verifies it.

## Tier: boundary — no exceptions in `src/`

The main entry does no IO of its own: `LspStdio` returns an Effect for the
caller's `runMain` and a `Runtime.Teardown`, and takes the process as a
structural `LspExitHost` parameter rather than reading it. `./testing` does
IO only through core's `ChildProcessSpawner`, required in `R`. `effect` is
the only peer and the only runtime import. `src/` never reads `process`, never imports `node:`,
an `@effect/platform*` package or any `@effected/*` package, and never
writes to stdout or the console — pinned by `__test__/boundary.test.ts`
over `SourceBoundary.scan` (`@effected/workspaces` is a devDependency for
that test alone).

**Nothing in the kit may depend on this package except an application.**
It is a front-end sibling of `@effected/mcp` and `@effected/cli`: no edge
between any two of them, and no library takes one. It does not depend on
`@effected/engine` and builds no process guard; the transport-neutral
guard is `@effected/engine`'s business.

## Exports

`@effected/lsp` (`src/index.ts`): `LspFrame` (`encode`, `decodeResult`,
`decode`, `decodeAllResult`, `decodeAll`, `decodeStream`), `LspFrameError`,
`LspFrameErrorCode`, `LspStdio` (`exitCode`, `launch`, `teardown`), plus
the `LspFrameDecoded`, `LspMessage`, `LspSessionEnd` and `LspExitHost` types.

`@effected/lsp/testing` (`src/testing.ts`): `LspProbe` (`initialize`),
`LspProcess` (`spawn`; instances carry `send`, `sendRaw`, `nextMessage`,
`readUntilResponse`, `closeStdin`, `exitCode`, `stderrSoFar`,
`stderrUntil`, `stderrFinal`, `stdoutSoFar`, `stdoutFinal`,
`assertOnlyFrames`), `LspTestFailure`, plus the `LspProbeOptions`,
`LspProbeResult`, `LspProcessStderrUntilOptions` and `LspMessage` types.
`testing.ts` re-exports `LspMessage` because its own signatures name it; api-extractor models each entrypoint as its own surface.

## Load-bearing decisions

- **`Content-Length` counts UTF-8 bytes.** `encode` measures the encoded
  body; a `body.length` header is wrong by one per extra byte of every
  multi-byte character. The property tests generate multi-byte bodies so a
  char-counting mutant fails.
- **The decoder is incremental and pure.** `decodeResult(bytes, offset)`
  returns complete frames plus the copied bytes of an incomplete tail;
  `decodeStream` threads `rest` and the stream offset across chunks and
  fails `Truncated` when the stream ends inside a frame (an identity-compared
  end marker is appended internally). A header past 8 KiB without its
  terminator fails `HeaderTooLarge` rather than buffering without bound.
  The header scan is bounded per frame, so a chunked stream never rescans
  more than the cap.
- **`LspStdio.launch` reports a failure itself, on stderr.** `runMain`'s
  own report runs via `Effect.tapCause` outside every `Effect.provide` the
  program applies, so a `LogToStderr` provided inside never reaches it and
  a layer that fails to build prints onto the wire. `launch` catches the
  cause inside its own `LogToStderr` provision, logs it, and fails with the
  internal `LaunchFailed`, marked `Runtime.errorReported = false` and
  carrying the original `Runtime.errorExitCode` — the `McpStdio.launch`
  shape. `disableErrorReporting` on `runMain` would also work, but only if
  every consumer remembers it; the marker travels with the failure.
- **The shutdown/exit state lives in the server's message loop.** The kit
  owns no loop, so it cannot see `shutdown` or `exit`: the program returns
  an `LspSessionEnd` (`reason`, `shutdownReceived`) and `LspStdio.exitCode`
  applies the specification's rule (1 only for `exit` without `shutdown`;
  a stdin close is 0). okfit's `ListenOutcome` already has this shape.
- **`LspStdio.teardown(host)` always ends the process through the host.**
  `runMain` leaves a code-0 exit to the event loop draining, and with
  `NodeStdio` reading stdin it never drains while stdin is open — probed:
  a clean `shutdown`+`exit` sat until the client closed the pipe, which an
  editor never does first. There is deliberately no drain-only
  teardown; `LspStdio.test.ts` pins the hang with a no-op-host control.
- **One stdout reader.** `LspProbe` runs on `spawnParts` from
  `LspProcess.ts` (internal), with a `settle` option that folds the exit
  code and whole stderr into `StreamEnded` — safe only under the probe's
  outer timeout. `LspProcess`'s raw capture sits before the decoder, so
  `assertOnlyFrames` checks every byte even after a frame error stopped
  decoding; it is `LspFrame.decodeAllResult` over the capture.
- **The probe sends `initialized`** (the specification requires it before
  any other request, `shutdown` included) unless `initialize` answered with
  an error, and the sequence still ends `shutdown`, `exit`.
- **Stdin stays open after `exit`.** The server must terminate itself on
  `exit`; a probe that closed stdin would pass a server that only stops at
  EOF, which hangs in an editor. Such a server fails `TimedOut`.
- **Server requests are recorded in `messages`, never answered.**
- **Never hangs.** Every wait reads a queue the stdout reader ends or
  fails; the exchange sits under one timeout (default 30 seconds) whose
  failure names the pending step and the stderr so far; the probe's scope
  kills the child. The timeout reads `Clock`: test the probe under
  `it.live`, never `it.effect`.
- **The `./testing` split mirrors `@effected/mcp`.** `entrypoints.test.ts`
  pins that nothing reachable from `.` imports the probe, with positive
  controls.

## Test and build

Tests live in `__test__/`, use `@effect/vitest`, assert with `assert.*` —
never `expect`. `__test__/fixtures/fake-lsp.mjs` is a hand-written stand-in
server, and `__test__/fixtures/lsp-main.ts` a hand-written `main.ts` over
`LspStdio`, run unbuilt through `ts-resolve.mjs`; the README states what
each flag pins.

```bash
pnpm vitest run --project @effected/lsp   # from the repo root
pnpm build --filter @effected/lsp         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips
`build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` that
looks exactly like a clean gate.
