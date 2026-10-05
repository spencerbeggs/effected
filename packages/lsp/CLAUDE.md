# @effected/lsp

Language Server Protocol base-protocol framing as pure functions, plus a
`./testing` subpath whose `LspProbe` proves a Language Server bin boots —
the LSP twin of `@effected/mcp/testing`'s `McpProbe`. Not an LSP server
framework: serving the protocol stays with whatever the consumer serves it
with (okfit's `okfit-lsp` is a `vscode-languageserver` program, not an
Effect one).

**Design doc:** `@./okf/modules/lsp.md` — Load when: changing the public
surface, the framing rules, or the probe's lifecycle sequence.
`okf/modules/lsp.md` stays `status: draft` until the user verifies it.

## Tier: boundary — no exceptions in `src/`

The main entry is pure; `./testing` does IO only through core's
`ChildProcessSpawner`, required in `R`. `effect` is the only peer and the
only runtime import. `src/` never reads `process`, never imports `node:`,
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
`LspFrameErrorCode`, plus the `LspFrameDecoded` and `LspMessage` types.

`@effected/lsp/testing` (`src/testing.ts`): `LspProbe` (`initialize`),
`LspTestFailure`, plus the `LspProbeOptions`, `LspProbeResult` and
`LspMessage` types. `testing.ts` re-exports `LspMessage` because its own
signatures name it; api-extractor models each entrypoint as its own surface.

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
- **The probe sends `initialized`** (the specification requires it before
  any other request, `shutdown` included) unless `initialize` answered with
  an error, and the sequence still ends `shutdown`, `exit`.
- **Stdin stays open after `exit`.** The server must terminate itself on
  `exit`; a probe that closed stdin would pass a server that only stops at
  EOF, which hangs in an editor. Such a server fails `Timeout`.
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
server; its README states what each flag pins.

```bash
pnpm vitest run --project @effected/lsp   # from the repo root
pnpm build --filter @effected/lsp         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips
`build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` that
looks exactly like a clean gate.
