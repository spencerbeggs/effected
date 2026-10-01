---
type: Decision
title: The live view never calls Ink's clear(); a new run re-renders in place or remounts
description: "Ink's instance.clear() erases the frame but tells log-update the frame is still on screen, so the next differing render erases that many lines of scrollback above it; a start while mounted re-renders in place, a terminal event unmounts to commit the frame, and the next start mounts fresh (probe L5)."
status: draft
tags: [architecture, dx]
sources:
  - id: p5-probes
    resource: ../../docs/superpowers/specs/2026-10-01-p5-probes.md
    title: "P5 planning probe L5: remount and watch mode"
  - id: ink-clear
    resource: "npm:ink@7.1.1"
    title: "Ink 7.1.1, build/ink.js:655-662 (clear then log.sync(lastOutput)) and build/render.js:47-60 (instances keyed by stdout)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T09:31:36Z
  body_sha256: e52dcfba803819091e1bca7bc9526e69e52b8f76017f85eca9c4b7de8b492d53
---

# The live view never calls Ink's clear(); a new run re-renders in place or remounts

## Context

vitest-agent's live view called `clear()` when a new run started while a
frame was still mounted. The design spec carried that over.

Probe L5 ran it on a pty with history above the frame.[^p5-probes] `clear()`
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
  screen unmounts, which L5's `clearSame` mode showed keeps the history.

[^p5-probes]: `docs/superpowers/specs/2026-10-01-p5-probes.md`, section L5
[^ink-clear]: `npm:ink@7.1.1`, `build/ink.js:655-662` and `build/render.js:47-60`
