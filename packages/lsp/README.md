# @effected/lsp

Language Server Protocol base-protocol framing for Effect v4 — `Content-Length` frames encoded by byte length and decoded incrementally — a stdio launcher that keeps stdout the LSP wire and exits with the code the specification requires, and a `./testing` subpath whose `LspProbe` proves a Language Server bin boots and whose `LspProcess` drives one frame by frame.

[![npm](https://img.shields.io/npm/v/@effected%2Flsp?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/lsp)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `^4.0.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Install

```bash
npm install @effected/lsp effect
```

```bash
pnpm add @effected/lsp effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED`. Import from an ES module.

`effect` v4 is the only peer dependency. Boundary tier: the main entry is pure, and `./testing` runs a child process only through core's `ChildProcessSpawner`, which you provide with one platform layer (`NodeServices.layer` from `@effect/platform-node`).

This is not an LSP server framework. It frames the wire, launches a server you wrote, and tests the bin; the message loop and every handler stay with whatever you serve the protocol with.

## LspFrame

An LSP message travels as a header block, a blank line, and a UTF-8 JSON body whose `Content-Length` counts **bytes**. A hand-rolled frame that writes `body.length` is right for ASCII and wrong by one for every extra byte of a multi-byte character, so the server reads into the next frame. `LspFrame.encode` counts the encoding:

```ts
import { LspFrame } from "@effected/lsp";

const frame = LspFrame.encode({ jsonrpc: "2.0", method: "note", params: { text: "✓" } });
console.log(new TextDecoder().decode(frame));
// => Content-Length: 57
//
//    {"jsonrpc":"2.0","method":"note","params":{"text":"✓"}}
```

Decoding is incremental. `LspFrame.decodeResult` takes whatever bytes have arrived and returns every complete frame plus the bytes of an incomplete one, so a chunk may end inside a header, a body or a character, and may carry several frames. `LspFrame.decodeStream` threads that across a `Stream` of chunks, and `LspFrame.decodeAllResult` decodes a collected stdout in one go:

```ts
import { LspFrame } from "@effected/lsp";
import { Result } from "effect";

const decoded = LspFrame.decodeAllResult('Content-Length: 2\r\n\r\n{}Content-Length: 5\r\n\r\n"✓"');
console.log(Result.getOrThrow(decoded));
// => [ {}, '✓' ]
```

A malformed stream fails with a typed `LspFrameError` whose `code` says which rule broke (`MissingContentLength`, `InvalidContentLength`, `InvalidHeader`, `HeaderTooLarge`, `InvalidBody`, `Truncated`), whose `offset` is the frame's stream position, and whose `excerpt` echoes the frame's start — a log line written to stdout before the first frame shows up there verbatim. `decode` and `decodeAll` are the `Effect` forms.

## LspStdio

An Effect Language Server over stdio has three traps, and `LspStdio` closes each:

- **`runMain` reports a failed program on stdout.** Its report runs outside every `Effect.provide` the program applies, so a `LogToStderr` provided inside never reaches it: a layer that fails to build (a missing `HOME`, a bad config) prints its report onto the wire. `LspStdio.launch` provides `LogToStderr` to the whole program, reports a failure on stderr itself, and re-raises it marked as already reported, keeping its exit code.
- **The exit code is the specification's.** `exit` without a prior `shutdown` exits 1; everything else 0. `LspStdio.exitCode` is that rule, and `launch` applies it to the `LspSessionEnd` your message loop returns.
- **A clean exit never happens on its own.** `runMain` ends the process itself only for a non-zero code or a signal, and leaves code 0 to the event loop draining, which it never does while stdin is open — and after `exit`, stdin is still open. `LspStdio.teardown(process)` ends the process explicitly, and maps SIGINT and SIGTERM to 0 instead of 130.

```ts
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { LspStdio } from "@effected/lsp";
import { Effect } from "effect";
import { AppLayer, serve } from "./server.js";

// `serve` is your server: it runs the message loop and returns how the session ended.
NodeRuntime.runMain(LspStdio.launch(serve.pipe(Effect.provide(AppLayer))), {
  teardown: LspStdio.teardown(process),
});
```

The kit does not own the message loop, so it cannot see `shutdown` or `exit` itself: your loop records them and returns `{ reason: "exit" | "closed", shutdownReceived }`. A `vscode-languageserver` connection reports both through `onShutdown` and `onExit`.

`LogToStderr` reaches Effect's default logger and `Logger.consolePretty`. `Logger.consoleJson`, `consoleLogFmt` and `consoleStructured` write through `console.log` regardless — wrap a formatter in `Logger.withConsoleError` instead — and `Console.log` still writes to stdout.

## LspProbe (`@effected/lsp/testing`)

The packed-install proof for a Language Server bin, the twin of `@effected/mcp/testing`'s `McpProbe`. It spawns the command and runs the lifecycle an editor runs — `initialize`, `initialized`, `shutdown`, `exit` — then waits for the server to exit:

```ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LspProbe } from "@effected/lsp/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";

const program = Effect.gen(function* () {
  const probe = yield* LspProbe.initialize(ChildProcess.make("my-lsp", ["--stdio"]));
  // A clean boot: no JSON-RPC error, exit code 0 (shutdown preceded exit), nothing on stderr.
  return probe.response.error === undefined && probe.exitCode === 0 && probe.stderr === "";
}).pipe(Effect.provide(NodeServices.layer));
```

- `initialize` goes out with `processId` and `rootUri` `null` and empty client capabilities unless `LspProbeOptions` says otherwise.
- Stdin stays open after `exit`: the server must stop on `exit`, as it must under an editor. A server that waits for stdin to close fails with `TimedOut`.
- Every message the server sent is in `messages`, in order; requests it sends to the client are recorded and never answered.
- It never hangs: stdout that ends early fails `StreamEnded` with the exit code and stderr, bytes that are not frames fail `InvalidFrame`, and the whole exchange runs under `timeout` (30 seconds by default). Run it under `it.live` — the timeout reads `Clock`.

## LspProcess (`@effected/lsp/testing`)

A spawned server a test drives frame by frame — the LSP twin of `@effected/mcp/testing`'s `McpProcess`. The child lives for the enclosing scope:

```ts
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LspProcess } from "@effected/lsp/testing";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";

const program = Effect.gen(function* () {
  const server = yield* LspProcess.spawn(ChildProcess.make("my-lsp", ["--stdio"]));
  yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: null, capabilities: {} } });
  const { response, seen } = yield* server.readUntilResponse(1);
  yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown" });
  yield* server.readUntilResponse(2);
  yield* server.send({ jsonrpc: "2.0", method: "exit" });
  const exitCode = yield* server.exitCode;
  // Stdout held nothing but frames: no stray byte before, between or after them.
  const messages = yield* server.assertOnlyFrames;
  return { response, seen, exitCode, messages };
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));
```

- `send` frames with `LspFrame.encode`; `sendRaw` writes bytes as given, for a malformed or split frame.
- `nextMessage` and `readUntilResponse` never hang: stdout that ends fails `StreamEnded` (inside a frame too), bytes that are not a frame fail `InvalidFrame`, and a body that is not JSON-RPC fails `NotJsonRpc`.
- `stderrUntil(predicate, { timeout })` waits for a report that lands on a later tick, woken by each stderr chunk rather than a polling timer, and fails `StreamEnded` or `TimedOut` with the stderr so far. Run it under `it.live`.
- `stdoutSoFar` and `stdoutFinal` return the raw bytes; `assertOnlyFrames` waits for stdout to end and fails `InvalidFrame`, naming the offset and quoting the stray bytes, unless every byte belonged to a well-formed frame.

## License

MIT
