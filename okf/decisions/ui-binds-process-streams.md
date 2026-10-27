---
type: Decision
title: Only ./ui may bind Node's process streams, and only in three named files
description: "@effected/cli/ui alone may rely on Node's process streams, because Ink has exactly one platform shape; the licence is file-scoped to processStreams.ts, CliUiRouteStream.ts and the testing-only fakeStreams.ts, and does not generalize the platform-node licence."
status: stable
tags: [architecture, compat]
sources:
  - id: ink-render
    resource: "npm:ink@8.0.0"
    title: "Ink 8.0.0, build/render.js:9: render() defaults stdout, stdin and stderr to the process streams"
  - id: cli-boundary-test
    resource: ../../packages/cli/__test__/boundary.test.ts
    title: The boundary test that holds the waived set exact
generated:
  by: "okfit/claude-code"
  at: 2026-10-27T13:22:20Z
integrity:
  generated:
    body: ecc8a94468178597
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 8c177234e76de2ab
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# Only ./ui may bind Node's process streams, and only in three named files

## Context

The `@effected/cli` root reads no `process` and imports no `node:` module. It
reaches the terminal through core's services (`Console`, `Terminal`) and
`@effected/env`, so it runs anywhere Effect runs.

Ink cannot be written that way. Its `render()` defaults `stdout`, `stdin` and
`stderr` to the process streams, and every stream it takes must be a Node
stream, an event emitter it reads `isTTY`, `columns` and `rows` from when they
are there, and puts in raw mode only when it is a TTY with
`setRawMode`.[^ink-render] Core's `Stdio` hands out Effect sinks and streams,
not Node stream objects. Ink has exactly one platform shape, so `./ui` is
Node-only by nature; Bun is compatible because it provides the same objects.

The licence once named `inkChalk.ts` as its second file; the chalk
resolution moved onto `ModuleResolution` and `CliUiRouteStream.ts` took the
slot, so the count stayed three.

## Decision

`./ui` alone may rely on Node's process streams. The licence is granted on
its own argument, and it is scoped to three named files:

- `src/ui/internal/processStreams.ts` reads `process.stdin`, `process.stdout`
  and `process.stderr`, and nothing else. It is the default `UiStreams`.
- `src/ui/CliUiRouteStream.ts` imports `node:stream`, and nothing else from
  Node, for the `Writable` that `CliUi.routeStream` returns. A writer that is
  not the program's own (a child's stderr, an in-process test runner or
  bundler) needs a Node stream to write to, so the stream is the contract and
  cannot be an Effect sink. It reads no `process`.
- `src/ui/testing/fakeStreams.ts` is **testing-only** and reachable only from
  `./ui/testing`. It may import `node:stream`, to build the
  in-memory TTY streams the screen harness drives. It may also read
  `process`, for one thing that touches no stream: when Ink's `cli-cursor`
  hides the cursor on a fake TTY, it arms `restore-cursor`'s exit hook, which
  writes `ESC[?25h` to the real `process.stderr` at exit. The fakes remove
  that hook from `signal-exit`'s process-wide emitter as the hide escape
  reaches them (#983), so a run on the fakes leaves the process's own
  streams untouched.

Every other file under `src/ui/` is held to the root's rules. Each file joins
the boundary test's exact waiver list when it lands, so a waiver that waives
something unexpected, or a fourth file that touches Node, fails the
test.[^cli-boundary-test] The same test pins the `node:` importers reachable
from `./ui` to `CliUiRouteStream.ts` alone, so the testing fakes never reach
a production entry.

Ink's chalk is resolved without a licence of its own:
`src/ui/internal/inkChalk.ts` imports no `node:` module, and loads
`@effected/commands/node-sync`'s `ModuleResolution` by dynamic import only
when a screen mounts ([why](ink-colour-via-inks-own-chalk.md)). The Node
calls live in that published subpath, which is where Node-only module
resolution belongs, and the boundary test pins it as reached from the Ink
loader alone, never from `.` or `./testing`.

This does not generalize
[the platform-node licence](platform-node-peer-in-one-package.md). `./ui`
takes no platform package, required or optional; the licence is three files
of one subpath, not a package edge. The `@effected/commands` edge it uses for
chalk is a regular dependency of the whole package, and `./ui` imports only
its `./node-sync` subpath.

## Alternatives rejected

- **Bind Ink through `TerminalEnv` or core's `Stdio`.** Rejected. Neither
  provides a Node stream, and wrapping an Effect sink in a fake Node stream
  for production would re-implement the stream contract Ink already gets
  from the process.
- **Take `@effect/platform-node` as a peer of `./ui`.** Rejected. It would
  still have to hand Ink the process streams, and it drags a platform package
  into the manifest for no capability.
- **Waive `process` and `node:*` for all of `src/ui/**`.** Rejected. A
  directory-wide waiver lets any new widget read the environment directly,
  which is exactly what the root's rules exist to stop.

## Consequences

The licence is the boundary test's waiver list, so widening it is a reviewed
edit to one test. A consumer on a runtime without Node's stream objects can
still use the root; it cannot mount a screen.

[^ink-render]: `npm:ink@8.0.0`, `build/render.js:9`
[^cli-boundary-test]: `../../packages/cli/__test__/boundary.test.ts`
