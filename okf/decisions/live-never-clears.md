---
type: Decision
title: The live view never calls Ink's clear(); a new run re-renders in place or remounts
description: "Ink 8's clear() no longer erases scrollback, which a pty probe confirmed against Ink 7 as the control, but the live view has no path that needs it: a start while mounted re-renders in place, a terminal event unmounts to commit the frame (clear() then unmount() would leave no frame), and the next start mounts fresh."
status: draft
tags: [architecture, dx]
sources:
  - id: pinned-by
    resource: ../../packages/cli/__test__/ui/CliUiTest.live.test.ts
    title: "The live-view tests assert no full clear and no ESC[3J is ever written, and a new run re-renders in place"
  - id: ink-clear
    resource: "npm:ink@8.0.0"
    title: "Ink 8.0.0, build/ink.js:917-923 (clear) and 229-233 (the next render forgets a cleared frame), build/log-update.js:57-60 (clear erases the frame and zeroes its line count), build/render.js:46-62 (instances keyed by stdout)"
  - id: pty-probe
    resource: https://github.com/spencerbeggs/effected/issues/957
    title: "The pty probe of clear() on Ink 7.1.1 and Ink 8.0.0, four sequences, replayed through screenAfter"
    last_modified: 2026-10-21T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-10-21T17:30:00Z
integrity:
  generated:
    body: 1aeb5222ff6b8247
---

# The live view never calls Ink's clear(); a new run re-renders in place or remounts

## Context

vitest-agent's live view called `clear()` when a new run started while a
frame was still mounted, and the first design carried that over. On Ink 7,
`clear()` erased the frame and then called `log.sync(lastOutput)`, so
log-update still counted the old frame's lines. The next render that
differed erased that many lines **above** the frame, deleting the history
and the prompt.[^pinned-by]

Ink 8's `clear()` zeroes log-update's line count and the recorded height, and
the next render forgets the cleared frame and draws in full.[^ink-clear] A
probe ran this on a real pty, 40 rows by 100 columns, with five lines of
history and a prompt above a 3-line frame. It replayed the raw bytes through
`screenAfter`:[^pty-probe]

| Sequence | Ink 7.1.1 | Ink 8.0.0 |
| --- | --- | --- |
| `clear()`, then a different frame twice | 3 history lines lost | history intact |
| `clear()`, then the same frame | 3 history lines lost, frame not redrawn | history intact, frame redrawn |
| unmount, then mount fresh | clean | clean |
| `clear()`, then `unmount()` | history intact, no final frame | history intact, no final frame |

Ink 8 is fixed. What stays true on both versions is that `clear()` followed by
`unmount()` commits nothing.

## Decision

- The live view never calls `clear()`. This is because no path needs it, no
  longer because it is unsafe.
- A start event while mounted re-renders in place with the new run's state.
  A `clear()` there would only add a blank frame.
- A terminal event unmounts, which commits the final frame. It must not clear
  first, or nothing is committed.
- The next start mounts a fresh instance.
- One scoped holder per stdout guarantees the kit never calls `render()` on
  a stdout that already holds a live instance.

## Alternatives rejected

- **`clear()` on a start while mounted.** It is safe on Ink 8 but redundant,
  because re-rendering in place already replaces the frame.
- **`clear()` before the terminal unmount.** It leaves no final frame, on
  Ink 7 and Ink 8 alike.
- **Mounting a second instance.** Ink warns, reuses the instance and tears
  the frame.

## Consequences

- Watch mode leaves every run's final frame in the scrollback, one after
  another. `clear()` cannot change that, because the previous frame is
  already committed and its instance gone. A single frame across runs would
  mean keeping one instance mounted between runs, which is a design change
  of its own.
- `CliUi.run`'s own `clear` option is unaffected. It clears once, as the
  screen unmounts, which keeps the history.
- A future Ink upgrade does not need a new probe for this decision to hold,
  since it relies on nothing Ink fixed.

[^pinned-by]: `packages/cli/__test__/ui/CliUiTest.live.test.ts`, whose `written` reader is where a test asserts no `ESC[3J`.
[^ink-clear]: `npm:ink@8.0.0`, `build/ink.js:917-923` and `229-233`, `build/log-update.js:57-60`, and `build/render.js:46-62`
[^pty-probe]: <https://github.com/spencerbeggs/effected/issues/957>
