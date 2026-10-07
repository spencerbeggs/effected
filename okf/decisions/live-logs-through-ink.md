---
type: Decision
title: While a live view is mounted, kit logs go through Ink's own stdout and stderr writers
description: "The live view exposes a bridged Console whose writes go through Ink's useStdout().write and useStderr().write while a run is mounted, so a log line lands above the frame without tearing it, and straight to the stream before mount and after unmount, since Ink silently drops hook writes after unmount."
status: draft
tags: [architecture, observability]
sources:
  - id: pinned-by
    resource: ../../packages/cli/__test__/ui/inkConsole.test.ts
    title: "The console bridge writes above a live Ink frame on the production path"
  - id: ink-writers
    resource: "npm:ink@8.0.0"
    title: "Ink 8.0.0, build/ink.js:698-750 (writeToStdout/writeToStderr, early return when unmounted) and build/render.js:23-36 (the instance has no writers)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: a417a94bc2de2a1d2b9bea06ced46b3d65d13029922baf3596bb1bcac0e77e92
---

# While a live view is mounted, kit logs go through Ink's own stdout and stderr writers

## Context

`CliUi.run` forbids logging while a screen is mounted: Ink redraws by
counting the lines it last wrote, so a line from elsewhere lands inside the
frame and tears it. A live view lasts a whole test run, so "do not log" is
not an option.

A probe tried seven mechanisms on a pty.[^pinned-by] `<Static>`, the hook
writers (`useStdout().write`, `useStderr().write`) and `patchConsole` were
clean; raw `process.stdout` and `process.stderr` writes left stale frame
copies and erased the log lines; `clear()` then a raw write destroyed the
history. The instance `render()` returns has no writers: they live on the
internal `Ink` class, reached only through the hooks, and each returns early
once unmounted, so a write after unmount is silently lost.[^ink-writers]

## Decision

- A kit-internal bridge component, mounted inside the live tree, captures
  `useStdout().write` and `useStderr().write`.
- The live handle exposes a `Console` over that bridge: `log` and `info` go
  to the stdout writer and `error` and `warn` to the stderr writer, keeping
  the kit's stdout/stderr contract.
- Before a run mounts, and from just **before** `unmount()`, the same
  `Console` writes straight to `UiStreams`, so no line hits Ink's drop.

## Alternatives rejected

- **`<Static>`.** It needs an append-only items array in React state
  (unbounded in watch mode), is throttled, and puts stderr lines on stdout.
- **`patchConsole`.** It hijacks the global console, which a hosted view
  must leave to its host (Vitest), and the kit's loggers do not go through
  `console` reliably.

## Consequences

- A consumer provides the bridged `Console` around the work it does while
  the view is mounted; a log written any other way still tears the frame.
- A degrade warning is written after the unmount, never mid-frame.

[^pinned-by]: `packages/cli/__test__/ui/inkConsole.test.ts`, which asserts the bridged writes land above the frame on the production path. The seven-mechanism probe that chose it was run once and is not kept.
[^ink-writers]: `npm:ink@8.0.0`, `build/ink.js:698-750` and `build/render.js:23-36`
