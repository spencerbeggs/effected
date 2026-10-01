---
type: Decision
title: The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook
description: "Ink 7.1.1 does not miscount a line exactly columns wide, but a frame taller than the terminal makes Ink emit ESC[3J and wipe the scrollback, and a root width read from useTerminalSize lags Ink's own resize repaint and strands a copy on shrink; so the clamp is on height, and a margin, if wanted, is marginRight 1."
status: draft
tags: [architecture, compat]
sources:
  - id: pinned-by
    resource: ../../packages/cli/__test__/ui/CliUiTest.live.test.ts
    title: "The live-view tests: the frame is clamped to rows - 1, and a resize repaints without stranding a copy"
  - id: ink-resize
    resource: "npm:ink@7.1.1"
    title: "Ink 7.1.1, build/ink.js:89-112,763-768 (clear-terminal for a tall frame) and 264-290 (resize re-layout)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T14:11:47Z
  body_sha256: d7a5a2e1cdbfd4095a600425b93aceb162bdd214744cf42da4cfe9e6f944f3da
---

# The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook

## Context

vitest-agent clamped its live frame's width to `columns - 1`, against a
belief that Ink miscounts `eraseLines` for lines exactly `columns` wide and
strands header copies. The first design carried the clamp over.

A probe found no such miscount in Ink 7.1.1, on a deferred-wrap emulator or
in iTerm2.[^pinned-by] It found a different hazard: a frame taller than the
viewport takes Ink's clear-terminal path, which writes `ESC[3J` and wipes the
scrollback on every overflowing frame.[^ink-resize] A second probe then found the
one real strand: Ink re-lays out the existing tree on `resize` before React
re-renders, so a root `width` read from `useTerminalSize` is one paint
stale, and on a shrink Ink first paints the wider frame into the narrower
terminal.

## Decision

- The live frame's height is `min(content, rows - 1)`, re-read from
  `UiStreams.stdout` on every render and on resize.
- The root `Box` takes no explicit width at all. If a one-column margin is
  wanted, it is `marginRight: 1` (or `paddingRight: 1`), which Yoga
  recomputes inside Ink's synchronous resize.
- Width-dependent content (truncation through `useTerminalSize().columns`)
  stays allowed; long rows use Ink's `wrap="truncate-end"` so Yoga clips
  rather than the terminal wrapping.

## Alternatives rejected

- **A `columns - 1` root width from a hook.** It causes the strand it was
  meant to cure.
- **No clamp.** A long run wipes the user's scrollback with `ESC[3J`.

## Consequences

- A frame with more rows than fit loses its bottom rows rather than the
  user's history; a consumer that cares windows its own rows (`Viewport`).
- A glyph some emulator draws wider than `string-width` counts can still
  strand a copy; `marginRight: 1` is the hedge if one turns up.
- The height clamp is itself hook-derived (`useTerminalSize().rows`), so it
  carries the resize lag in the other dimension: on a resize Ink re-lays out and
  repaints the tree it has before React re-renders, so after a **height**
  shrink a frame already at its full height is painted once taller than the
  terminal and takes the clear-terminal path. Yoga cannot read the terminal,
  so this is documented on `CliUi.live`, not fixed; a frame with spare rows
  never meets it.

[^pinned-by]: `packages/cli/__test__/ui/CliUiTest.live.test.ts` and `CliUi.live.test.ts`, the height clamp and the resize behaviour. The probes that found them (a deferred-wrap emulator and iTerm2 for the width question, a resize on a pty for the strand) were run once and are not kept.
[^ink-resize]: `npm:ink@7.1.1`, `build/ink.js:89-112`, `763-768` and `264-290`
