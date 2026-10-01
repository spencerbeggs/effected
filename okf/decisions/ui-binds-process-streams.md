---
type: Decision
title: Only ./ui may bind Node's process streams, and only in three named files
description: "@effected/cli/ui alone may rely on Node's process streams, because Ink has exactly one platform shape; the licence is file-scoped to processStreams.ts, inkChalk.ts and the testing-only fakeStreams.ts, and does not generalize the platform-node licence."
status: draft
tags: [architecture, compat]
sources:
  - id: ink-render
    resource: "npm:ink@7.1.1"
    title: "Ink 7.1.1, build/render.js: render() defaults stdout, stdin and stderr to the process streams"
  - id: cli-boundary-test
    resource: ../../packages/cli/__test__/boundary.test.ts
    title: The boundary test that holds the waived set exact
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T03:17:21Z
  body_sha256: 5a8f9c4dd1a7dfceda390530ff82346e4d55c3f48f3c40d1d84df206e09e9113
---

# Only ./ui may bind Node's process streams, and only in three named files

## Context

The `@effected/cli` root reads no `process` and imports no `node:` module. It
reaches the terminal through core's services (`Console`, `Terminal`) and
`@effected/env`, so it runs anywhere Effect runs.

Ink cannot be written that way. Its `render()` defaults `stdout`, `stdin` and
`stderr` to the process streams, and every stream it takes must be a Node
stream: `isTTY`, `columns`, `rows`, `setRawMode`, `ref` and `unref`, and an
event emitter.[^ink-render] Core's `Stdio` hands out Effect sinks and streams,
not Node stream objects. Ink has exactly one platform shape, so `./ui` is
Node-only by nature; Bun is compatible because it provides the same objects.

## Decision

`./ui` alone may rely on Node's process streams. The licence is granted on
its own argument, and it is scoped to three named files:

- `src/ui/internal/processStreams.ts` reads `process.stdin`, `process.stdout`
  and `process.stderr`, and nothing else. It is the default `UiStreams`.
- `src/ui/internal/inkChalk.ts` imports `node:module`, `node:url` and
  `node:fs`, to resolve the chalk that Ink itself imports
  ([why](ink-colour-via-inks-own-chalk.md)).
- `src/ui/testing/fakeStreams.ts` is **testing-only** and reachable only from
  `./ui/testing`. It may import `node:events` and `node:stream`, to build the
  in-memory TTY streams the screen harness drives.

Every other file under `src/ui/` is held to the root's rules. Each file joins
the boundary test's exact waiver list when it lands, so a waiver that waives
something unexpected, or a fourth file that touches Node, fails the
test.[^cli-boundary-test]

This does not generalize
[the platform-node licence](platform-node-peer-in-one-package.md). `./ui`
takes no platform package, required or optional; the licence is three files
of one subpath, not a package edge.

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

[^ink-render]: `npm:ink@7.1.1`, `build/render.js`
[^cli-boundary-test]: `../../packages/cli/__test__/boundary.test.ts`
