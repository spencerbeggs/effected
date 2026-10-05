# @effected/lsp

Language Server Protocol base-protocol framing as pure functions, an `LspStdio` launcher for an Effect Language Server over stdio, plus a `./testing` subpath whose `LspProbe` proves a Language Server bin boots and whose `LspProcess` drives one frame by frame — the LSP twins of `@effected/mcp`'s `McpStdio`, `McpProbe` and `McpProcess`. Tier: boundary. `effect` is the only peer — no `@effected/*` edge, no `@effect/platform*` package, no `node:` import, no `process` read and no `console.*` call anywhere in `src/`. Not an LSP server framework: the message loop and every handler stay with whatever the consumer serves the protocol with (`vscode-languageserver` behind an Effect program is the expected subject).

## Import

```ts
import { LspFrame, LspFrameError, type LspMessage, type LspSessionEnd, LspStdio } from "@effected/lsp";
import { LspProbe, LspProcess, LspTestFailure } from "@effected/lsp/testing";
```

Two entrypoints. `./testing` is a separate module so the test clients never enter a runtime import graph; a reachability test pins that `.` never reaches them.

## Feature surface

| Reach for | When |
| --- | --- |
| `LspFrame.encode(message)` | writing an LSP frame — `Content-Length` is the UTF-8 **byte** length, never `body.length` |
| `LspFrame.decodeResult(bytes, offset?)` / `decode` | decoding a buffer that may end mid-frame: every complete frame plus the bytes of the incomplete one as `rest` |
| `LspFrame.decodeAllResult(input)` / `decodeAll` | decoding a collected stdout (`string` or `Uint8Array`); leftover bytes fail `Truncated` |
| `LspFrame.decodeStream(stream)` | turning a `Stream` of byte chunks (a child's stdout) into a `Stream` of messages |
| `LspStdio.launch(program)` + `LspStdio.teardown(process)` | the `main.ts` of an Effect Language Server over stdio: failures reported on stderr, never stdout; the specification's exit code; the process ends on `exit` |
| `LspStdio.exitCode(end)` | the specification's rule on its own: `exit` without `shutdown` is 1, else 0 |
| `LspProbe.initialize(command, options?)` | the LSP half of a packed-install proof: `initialize` → `initialized` → `shutdown` → `exit`, exit 0 |
| `LspProcess.spawn(command)` | a test that drives a server bin message by message, waits on a stderr report, or proves stdout held only frames (`assertOnlyFrames`) |

## Core API

- **`LspFrame`** — a static-namespace class. `encode(message: unknown): Uint8Array` throws only on a value JSON cannot encode (a caller bug). `decodeResult(bytes, offset = 0): Result<LspFrameDecoded, LspFrameError>` is the sync primitive; `rest` is a copy, and `offset` is the stream position of `bytes[0]` so an error names a stream position. Header fields end `\r\n`, the block ends `\r\n\r\n`, names are case-insensitive, `Content-Type` and other unknown fields are ignored, `Content-Length` must be one decimal safe integer, and a header past 8 KiB without its terminator fails `HeaderTooLarge` instead of buffering without bound. The body must be valid UTF-8 (decoded `fatal`) and valid JSON. `decodeStream` threads `rest` and the offset across chunks and fails `Truncated` when the stream ends inside a frame.
- **`LspFrameError`** — `Schema.TaggedError` with `code` (`MissingContentLength` · `InvalidContentLength` · `InvalidHeader` · `HeaderTooLarge` · `InvalidBody` · `Truncated`; the literal schema is `LspFrameErrorCode`), `offset`, an optional JSON-quoted `excerpt` of the frame's first 80 bytes, and an optional `cause` (the UTF-8 or JSON failure as the original value). `message` is a getter. A log line a server writes to stdout before its first frame lands as `InvalidHeader`, with the line in the excerpt.
- **`LspProbe.initialize`** (`./testing`) — `(command: ChildProcess.Command, options?: LspProbeOptions) => Effect<LspProbeResult, LspTestFailure | PlatformError, ChildProcessSpawner>`. Sends `initialize` (id 1; `processId` and `rootUri` `null`, `capabilities` `{}`, `initializationOptions` only when given), waits for its response, sends `initialized` (skipped only when `initialize` answered an error), `shutdown` (id 2), waits, sends `exit`, and waits for the exit code **with stdin still open**. Returns `{ response, shutdown, messages, stderr, exitCode }`; `messages` holds every server message in order, including server→client requests, which the probe never answers. Assert `response.error === undefined`, `exitCode === 0` (the spec's code for `exit` after `shutdown`) and, for a clean boot, `stderr === ""`.
- **`LspStdio`** — `launch<E, R>(program: Effect<LspSessionEnd, E, R>): Effect<0 | 1, Error, R>` provides `LogToStderr` to the whole program, maps the `LspSessionEnd` (`{ reason: "exit" | "closed", shutdownReceived }`, returned by the server's own message loop) through `exitCode`, and reports a non-interrupt failure on stderr itself, re-raising it marked already reported with its exit code kept. `teardown(host: LspExitHost): Runtime.Teardown` hands a numeric success on as the code, maps interrupt-only to 0, defers anything else to `Runtime.defaultTeardown`, then calls `host.exit(code)` — pass `process`. `exitCode(end)` is 1 only for `exit` without `shutdown`.
- **`LspProcess`** (`./testing`) — `spawn(command): Effect<LspProcess, PlatformError, ChildProcessSpawner | Scope>`. Instances: `send` (an `LspFrame.encode` frame), `sendRaw` (bytes as given), `nextMessage`, `readUntilResponse(id)` → `{ response, seen }`, `closeStdin` (`Queue.end`), `exitCode`, `stderrSoFar`, `stderrUntil(predicate, { timeout })` (event-driven; fails `StreamEnded` or `TimedOut`), `stderrFinal`, `stdoutSoFar` / `stdoutFinal` (raw bytes), `assertOnlyFrames` (waits for stdout to end; `InvalidFrame` on any byte outside a well-formed frame, `NotJsonRpc` on a non-JSON-RPC body; returns every message).
- **`LspTestFailure`** (`./testing`) — `reason: "StreamEnded" | "InvalidFrame" | "NotJsonRpc" | "TimedOut"`, `message`. `StreamEnded` folds in the exit code and stderr (a stream that ends inside a frame lands here too, with the frame error); `TimedOut` names the step the probe was waiting on and the stderr so far.

## Usage

```ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { LspProbe } from "@effected/lsp/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";

it.live("the installed language server boots", () =>
  Effect.gen(function* () {
    const probe = yield* LspProbe.initialize(
      ChildProcess.make("my-lsp", ["--stdio"], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } }),
    );
    assert.isUndefined(probe.response.error);
    assert.strictEqual(probe.exitCode, 0);
    assert.strictEqual(probe.stderr, "");
  }).pipe(Effect.provide(NodeServices.layer)),
);
```

## Gotchas

- **`runMain` reports a failed program on stdout.** Its report runs outside every `Effect.provide` the program applies, so `Effect.provide(Layer.succeed(References.LogToStderr, true))` inside the program does not reach it, and a layer that fails to build (a missing `HOME`) prints onto the wire. Wrap the program in `LspStdio.launch`.
- **A code-0 exit never ends a stdio server on its own.** `runMain` leaves it to the event loop, and a server reading stdin (through `NodeStdio`, or `vscode-languageserver` under `--clientProcessId`) never drains while the editor holds the pipe open after `exit`. Use `LspStdio.teardown(process)`, which exits explicitly.
- **`LogToStderr` does not reach every logger.** Effect's default logger and `Logger.consolePretty` honour it; `Logger.consoleJson`, `consoleLogFmt` and `consoleStructured` write through `console.log` regardless. Wrap a formatter in `Logger.withConsoleError`.

- **Run the probe and `LspProcess` waits under `it.live`.** Its timeout (default 30 seconds, over the whole exchange) reads `Clock`; under `it.effect`'s virtual clock it never fires, and a hung server hangs the test to vitest's own timeout.
- **A server that stops only at stdin EOF fails `TimedOut` — on purpose.** The specification makes the server exit on `exit`, and an editor never closes the pipe first, so such a server hangs in use. Do not "fix" the test by closing stdin.
- **An explicit `env` replaces the child's whole environment.** A server that resolves XDG or home directories needs `HOME` passed through; without it, a real `vscode-languageserver` bin (okfit's `okfit-lsp`) fails at launch, and its launch report lands on stdout — so the probe reports `StreamEnded` with the report in the frame excerpt and an empty stderr.
- **Never hand-roll `Content-Length` from `body.length`.** It is right for ASCII and wrong by one per extra byte of every multi-byte character; the server then reads into the next frame and the failure surfaces far from the cause.
- **Nothing in the kit may depend on this package except an application.** It is a front-end sibling of `@effected/mcp` and `@effected/cli`, and it builds no process guard (that is `@effected/engine`'s `./guard`, which composes with `LspStdio`: call `markConnected` from inside the program once the transport is up).
