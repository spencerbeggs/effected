---
type: Decision
title: The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook
description: "Ink does not miscount a line exactly columns wide, but a frame taller than the terminal takes Ink's full-clear path, which homes the cursor and erases down on every frame and so stamps the frame's overflowing top rows into the scrollback again each time, and a root width read from useTerminalSize lags Ink's own resize repaint and strands a copy on shrink; so the clamp is on height, and a margin, if wanted, is marginRight 1."
status: draft
tags: [architecture, compat]
sources:
  - id: pinned-by
    resource: ../../packages/cli/__test__/ui/CliUiTest.live.test.ts
    title: "The live-view tests: the frame is clamped to rows - 1, and a resize repaints without stranding a copy"
  - id: ink-resize
    resource: "npm:ink@8.0.0"
    title: "Ink 8.0.0, build/ink.js:41 (homeAndEraseDown), 42-62 (shouldClearTerminalForFrame), 455-514 (renderInteractiveFrame's full-clear path) and 135-150 (resize re-layout)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: f3fabbeeae9cd252adff349ccb65de3ebaf09bb47d3624c6202f2371e7eab957
---

# The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook

## Context

vitest-agent clamped its live frame's width to `columns - 1`, against a
belief that Ink miscounts `eraseLines` for lines exactly `columns` wide and
strands header copies. The first design carried the clamp over.

A probe found no such miscount, on a deferred-wrap emulator or in
iTerm2.[^pinned-by] It found a different hazard: a frame taller than the
viewport takes Ink's full-clear path.[^ink-resize] Ink 8 writes that clear as
cursor-home then erase-down (`ESC[1;1H ESC[J`) and keeps the scrollback; Ink 7
wrote `ESC[3J` and wiped it. Either way the frame's rows above the viewport
scroll into the history, so every overflowing redraw stamps another copy of
them there. A second probe then found the one real strand: Ink re-lays out
the existing tree on `resize` before React re-renders, so a root `width`
read from `useTerminalSize` is one paint stale, and on a shrink Ink first
paints the wider frame into the narrower terminal.

## Decision

- The live frame's height is `min(content, rows - 1)`, re-read from
  `UiStreams.stdout` on every render and on resize, so it never meets the
  full-clear path and redraws in place.
- The root `Box` takes no explicit width at all. If a one-column margin is
  wanted, it is `marginRight: 1` (or `paddingRight: 1`), which Yoga
  recomputes inside Ink's synchronous resize.
- Width-dependent content (truncation through `useTerminalSize().columns`)
  stays allowed; long rows use Ink's `wrap="truncate-end"` so Yoga clips
  rather than the terminal wrapping.

## Alternatives rejected

- **A `columns - 1` root width from a hook.** It causes the strand it was
  meant to cure.
- **No clamp.** Every redraw of a long run takes the full-clear path: the
  viewport shows the frame's bottom rows rather than its top, and the
  scrollback fills with copies of the rows above it.

## Consequences

- A frame with more rows than fit loses its bottom rows rather than
  polluting the user's history; a consumer that cares windows its own rows
  (`Viewport`).
- A glyph some emulator draws wider than `string-width` counts can still
  strand a copy; `marginRight: 1` is the hedge if one turns up.
- The height clamp is itself hook-derived (`useTerminalSize().rows`), so it
  carries the resize lag in the other dimension: on a resize Ink re-lays out and
  repaints the tree it has before React re-renders, so after a **height**
  shrink a frame already at its full height is painted once taller than the
  terminal and takes the full-clear path. Yoga cannot read the terminal,
  so this is documented on `CliUi.live`, not fixed; a frame with spare rows
  never meets it.
- The tests hold it from both sides: the clamped frame never writes the
  full-clear sequence, and a control renders the same rows unclamped and
  sees it written.

[^pinned-by]: `packages/cli/__test__/ui/CliUiTest.live.test.ts`, `CliUi.live.test.ts` and `Viewport.test.ts`: the height clamp, its unclamped controls and the resize behaviour. The probes that found them (a deferred-wrap emulator and iTerm2 for the width question, a resize on a pty for the strand) were run once and are not kept.
[^ink-resize]: `npm:ink@8.0.0`, `build/ink.js:41`, `42-62`, `455-514` and `135-150`
