# @effected/lsp

Language Server Protocol base-protocol framing as pure functions, plus a `./testing` subpath whose `LspProbe` proves a Language Server bin boots — the LSP twin of `@effected/mcp/testing`'s `McpProbe`. Tier: boundary. `effect` is the only peer — no `@effected/*` edge, no `@effect/platform*` package, no `node:` import, no `process` read and no `console.*` call anywhere in `src/`. Not an LSP server framework: serving the protocol stays with whatever the consumer serves it with (a `vscode-languageserver` program is the expected subject).

## Import

```ts
import { LspFrame, LspFrameError, type LspMessage } from "@effected/lsp";
import { LspProbe, LspTestFailure } from "@effected/lsp/testing";
```

Two entrypoints. `./testing` is a separate module so the probe never enters a runtime import graph; a reachability test pins that `.` never reaches it.

## Feature surface

| Reach for | When |
| --- | --- |
| `LspFrame.encode(message)` | writing an LSP frame — `Content-Length` is the UTF-8 **byte** length, never `body.length` |
| `LspFrame.decodeResult(bytes, offset?)` / `decode` | decoding a buffer that may end mid-frame: every complete frame plus the bytes of the incomplete one as `rest` |
| `LspFrame.decodeAllResult(input)` / `decodeAll` | decoding a collected stdout (`string` or `Uint8Array`); leftover bytes fail `Truncated` |
| `LspFrame.decodeStream(stream)` | turning a `Stream` of byte chunks (a child's stdout) into a `Stream` of messages |
| `LspProbe.initialize(command, options?)` | the LSP half of a packed-install proof: `initialize` → `initialized` → `shutdown` → `exit`, exit 0 |

## Core API

- **`LspFrame`** — a static-namespace class. `encode(message: unknown): Uint8Array` throws only on a value JSON cannot encode (a caller bug). `decodeResult(bytes, offset = 0): Result<LspFrameDecoded, LspFrameError>` is the sync primitive; `rest` is a copy, and `offset` is the stream position of `bytes[0]` so an error names a stream position. Header fields end `\r\n`, the block ends `\r\n\r\n`, names are case-insensitive, `Content-Type` and other unknown fields are ignored, `Content-Length` must be one decimal safe integer, and a header past 8 KiB without its terminator fails `HeaderTooLarge` instead of buffering without bound. The body must be valid UTF-8 (decoded `fatal`) and valid JSON. `decodeStream` threads `rest` and the offset across chunks and fails `Truncated` when the stream ends inside a frame.
- **`LspFrameError`** — `Schema.TaggedError` with `code` (`MissingContentLength` · `InvalidContentLength` · `InvalidHeader` · `HeaderTooLarge` · `InvalidBody` · `Truncated`; the literal schema is `LspFrameErrorCode`), `offset`, an optional JSON-quoted `excerpt` of the frame's first 80 bytes, and an optional `cause` (the UTF-8 or JSON failure as the original value). `message` is a getter. A log line a server writes to stdout before its first frame lands as `InvalidHeader`, with the line in the excerpt.
- **`LspProbe.initialize`** (`./testing`) — `(command: ChildProcess.Command, options?: LspProbeOptions) => Effect<LspProbeResult, LspTestFailure | PlatformError, ChildProcessSpawner>`. Sends `initialize` (id 1; `processId` and `rootUri` `null`, `capabilities` `{}`, `initializationOptions` only when given), waits for its response, sends `initialized` (skipped only when `initialize` answered an error), `shutdown` (id 2), waits, sends `exit`, and waits for the exit code **with stdin still open**. Returns `{ response, shutdown, messages, stderr, exitCode }`; `messages` holds every server message in order, including server→client requests, which the probe never answers. Assert `response.error === undefined`, `exitCode === 0` (the spec's code for `exit` after `shutdown`) and, for a clean boot, `stderr === ""`.
- **`LspTestFailure`** (`./testing`) — `reason: "StreamEnded" | "InvalidFrame" | "NotJsonRpc" | "Timeout"`, `message`. `StreamEnded` folds in the exit code and stderr (a stream that ends inside a frame lands here too, with the frame error); `Timeout` names the step the probe was waiting on and the stderr so far.

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

- **Run the probe under `it.live`.** Its timeout (default 30 seconds, over the whole exchange) reads `Clock`; under `it.effect`'s virtual clock it never fires, and a hung server hangs the test to vitest's own timeout.
- **A server that stops only at stdin EOF fails `Timeout` — on purpose.** The specification makes the server exit on `exit`, and an editor never closes the pipe first, so such a server hangs in use. Do not "fix" the test by closing stdin.
- **An explicit `env` replaces the child's whole environment.** A server that resolves XDG or home directories needs `HOME` passed through; without it, a real `vscode-languageserver` bin (okfit's `okfit-lsp`) fails at launch, and its launch report lands on stdout — so the probe reports `StreamEnded` with the report in the frame excerpt and an empty stderr.
- **Never hand-roll `Content-Length` from `body.length`.** It is right for ASCII and wrong by one per extra byte of every multi-byte character; the server then reads into the next frame and the failure surfaces far from the cause.
- **Nothing in the kit may depend on this package except an application.** It is a front-end sibling of `@effected/mcp` and `@effected/cli`, and it builds no process guard (that is `@effected/engine`'s `./guard`).
