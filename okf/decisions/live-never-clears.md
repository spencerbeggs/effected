---
type: Decision
title: The live view never calls Ink's clear(); a new run re-renders in place or remounts
description: "A probe found Ink's instance.clear() erasing the frame while log-update still counted it, so the next render erased that many lines of scrollback above it; Ink 8's source forgets the cleared frame, but no probe has proved that on a terminal, so a start while mounted still re-renders in place, a terminal event unmounts to commit the frame, and the next start mounts fresh."
status: draft
tags: [architecture, dx]
sources:
  - id: pinned-by
    resource: ../../packages/cli/__test__/ui/CliUiTest.live.test.ts
    title: "The live-view tests assert no full clear and no ESC[3J is ever written, and a new run re-renders in place"
  - id: ink-clear
    resource: "npm:ink@8.0.0"
    title: "Ink 8.0.0, build/ink.js:917-923 (clear) and 229-233 (the next render forgets a cleared frame), build/render.js:46-62 (instances keyed by stdout)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: 409d3284f07e4f1f3a7a2c5b59588e393d96702515647e0ad2d29d934af52c84
---

# The live view never calls Ink's clear(); a new run re-renders in place or remounts

## Context

vitest-agent's live view called `clear()` when a new run started while a
frame was still mounted. The first design carried that over.

A probe ran it on a pty with history above the frame, on Ink 7.[^pinned-by]
`clear()` erased the frame and then called `log.sync(lastOutput)`, so
log-update still believed the old frame was on screen. The next differing render's
`eraseLines` then deletes that many lines **above** the frame: the history
and the prompt were gone. `clear()` then `unmount()` kept the history but
committed no final frame. Unmounting and mounting fresh on the same stdout,
even without awaiting `waitUntilExit`, was clean. Ink 8's `clear()` now sets
the recorded height to zero, and its next render forgets the cleared frame and
draws in full,[^ink-clear] which reads as a fix; it has not been probed on a
pty.

## Decision

- The live view never calls `clear()`.
- A start event while mounted re-renders in place with the new run's state.
- A terminal event unmounts, which commits the final frame.
- The next start mounts a fresh instance.
- One scoped holder per stdout guarantees the kit never calls `render()` on
  a stdout that already holds a live instance.

## Alternatives rejected

- **`clear()` on a start while mounted.** On Ink 7 it deleted frame-height
  lines of the user's scrollback; on Ink 8 that is fixed in source but
  unproven, and remounting is already correct.
- **Mounting a second instance.** Ink warns, reuses the instance and tears
  the frame.

## Consequences

- Watch mode leaves every run's final frame in the scrollback, one after
  another.
- `CliUi.run`'s own `clear` option is unaffected: it clears once, as the
  screen unmounts, which the probe's `clearSame` mode showed keeps the history.
- Switching to `clear()` would need a pty probe on the current Ink first;
  until then this decision stands on remounting, which needs no Ink fix.

[^pinned-by]: `packages/cli/__test__/ui/CliUiTest.live.test.ts`, whose `written` reader is where a test asserts no `ESC[3J`. The pty probe that found the hazard was run once and is not kept.
[^ink-clear]: `npm:ink@8.0.0`, `build/ink.js:917-923` and `229-233`, and `build/render.js:46-62`
