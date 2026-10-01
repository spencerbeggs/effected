---
type: Gotcha
title: Ink delivers every key in one stdin read before React re-renders
description: A key handler that steps from state captured in its render works one key at a time and repeats a move when several keys arrive in one read, because Ink dispatches them all before React re-renders; step from a functional update, a reducer or a ref instead.
status: draft
resource: ../../packages/cli/src/ui/KeyTable.ts
stale_after: "2027-03-30T00:00:00Z"
tags:
  - dx
  - testing
sources:
  - id: tabs-one-chunk-probe
    resource: "../../packages/cli/__test__/ui/Tabs.test.ts"
    author: "agent:claude-code"
    last_modified: "2026-10-01T05:17:00Z"
  - id: ink-input-parser
    resource: "npm:ink@7.1.1/build/input-parser.js"
    last_modified: "2026-10-01T05:17:00Z"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T05:18:37Z
  body_sha256: 3c2b9c5862a9aa3d208a28bf4bd5633d9499e52a292e7a911ef573ffcd23f29a
---

# Ink delivers every key in one stdin read before React re-renders

## What a reader sees

A widget's key handler reads its position from the render it was created
in (`const next = step(index, count, action)`, with `index` from
`useState`), and every test passes: `CliUiTest` presses keys one write at
a time and waits for the next frame between them, so each key meets a
fresh render.

## What they would wrongly conclude

That the handler is correct, because pressing → twice moved two tabs in
every test, and because React state "is the current state".

## What is actually true

Ink splits one stdin read into keys (at escape sequences and backspace
bytes) and dispatches them all synchronously, before React re-renders. A
second key in the same read runs the same handler closure and sees the
same captured `index`, so it repeats the first key's move instead of
continuing from it. A fast typist, a held arrow key or a terminal that
batches writes all produce such reads.

The probe that showed it wrote `\x1b[C\x1b[C` (→ →) as one `fake.input`
through the production `CliUi.run` path. The Tabs `onChange` calls came
out as `alpha 0, beta 1, beta 1` instead of `alpha 0, beta 1, gamma 2`.
`\x1b[Z\x1b[Z` (Shift-Tab twice) repeated the same way[^tabs-one-chunk-probe].

Two related facts bound the trap:

- **Plain text is never split.** Ink leaves `\t` and `\r` together
  because they can appear inside pasted text, so `\t\t` in one read
  reaches `useInput` as a single two-character string rather than as two
  Tab keys[^ink-input-parser].
- **`CliUiTest` cannot show it.** `handle.press` and `handle.type` write
  each key as its own chunk and settle between them. A test that wants
  to see this class of bug must write one chunk itself, on fake streams.

## The check

A `useKeys` dispatch must step from current state, never render-closure
state. Use any of:

- a functional update, `setState((current) => step(current, action))`;
- a `useReducer` dispatch;
- a ref that the handler itself advances.

Select, MultiSelect, Confirm and TextInput use functional updates. Tabs,
which also reports each step through `onChange` and may be controlled,
advances a ref that every render re-syncs. When reviewing a new widget,
cover it with a one-chunk test of two keys.

[^tabs-one-chunk-probe]: `__test__/ui/Tabs.test.ts`, "Tabs input in one chunk"
[^ink-input-parser]: Ink 7.1.1, `build/input-parser.js`, `splitBackspaceBytes`
