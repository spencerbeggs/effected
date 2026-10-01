---
type: Decision
title: The live view never calls Ink's clear(); a new run re-renders in place or remounts
description: "Ink's instance.clear() erases the frame but tells log-update the frame is still on screen, so the next differing render erases that many lines of scrollback above it; a start while mounted re-renders in place, a terminal event unmounts to commit the frame, and the next start mounts fresh."
status: draft
tags: [architecture, dx]
sources:
  - id: pinned-by
    resource: ../../packages/cli/__test__/ui/CliUiTest.live.test.ts
    title: "The live-view tests assert no ESC[3J is ever written and a new run re-renders in place"
  - id: ink-clear
    resource: "npm:ink@7.1.1"
    title: "Ink 7.1.1, build/ink.js:655-662 (clear then log.sync(lastOutput)) and build/render.js:47-60 (instances keyed by stdout)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: f204c408a6e88a33fe6c0418b1e23ad5a1c6b81dd868f42a87f384e8449d1cc3
---

# The live view never calls Ink's clear(); a new run re-renders in place or remounts

## Context

vitest-agent's live view called `clear()` when a new run started while a
frame was still mounted. The first design carried that over.

A probe ran it on a pty with history above the frame.[^pinned-by] `clear()`
erases the frame and then calls `log.sync(lastOutput)`, so log-update still
believes the old frame is on screen.[^ink-clear] The next differing render's
`eraseLines` then deletes that many lines **above** the frame: the history
and the prompt were gone. `clear()` then `unmount()` kept the history but
committed no final frame. Unmounting and mounting fresh on the same stdout,
even without awaiting `waitUntilExit`, was clean.

## Decision

- The live view never calls `clear()`.
- A start event while mounted re-renders in place with the new run's state.
- A terminal event unmounts, which commits the final frame.
- The next start mounts a fresh instance.
- One scoped holder per stdout guarantees the kit never calls `render()` on
  a stdout that already holds a live instance.

## Alternatives rejected

- **`clear()` on a start while mounted.** It deletes frame-height lines of
  the user's scrollback.
- **Mounting a second instance.** Ink warns, reuses the instance and tears
  the frame.

## Consequences

- Watch mode leaves every run's final frame in the scrollback, one after
  another.
- `CliUi.run`'s own `clear` option is unaffected: it clears once, as the
  screen unmounts, which the probe's `clearSame` mode showed keeps the history.

[^pinned-by]: `packages/cli/__test__/ui/CliUiTest.live.test.ts`, whose `written` reader is where a test asserts no `ESC[3J`. The pty probe that found the hazard was run once and is not kept.
[^ink-clear]: `npm:ink@7.1.1`, `build/ink.js:655-662` and `build/render.js:47-60`
