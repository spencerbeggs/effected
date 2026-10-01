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
  - id: chunk-test
    resource: "../../packages/cli/__test__/ui/CliUiTest.chunk.test.ts"
    author: "agent:claude-code"
    last_modified: "2026-10-01T05:29:00Z"
  - id: char-probe
    resource: "../../packages/cli/__test__/ui/CliUiTest.chunk.test.ts"
    author: "agent:claude-code"
    last_modified: "2026-10-01T05:50:00Z"
  - id: ink-input-parser
    resource: "npm:ink@7.1.1/build/input-parser.js"
    last_modified: "2026-10-01T05:17:00Z"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T06:07:29Z
  body_sha256: db755971d4b14d40a1f58d0f24908bced36b99a771a624da857bab2a2be58811
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
  Tab keys[^ink-input-parser]. A probe of single reads found Ink drops
  nothing either: `"yy"`, `"y\r"` and `"\t\t"` each arrive as one input
  string with no `return` or `tab` flag, and only a backspace byte is
  split out as its own key[^char-probe]. `useKeys` therefore splits text
  of more than one code point into a key per code point (`\r` as enter,
  `\t` as tab, a space as space), so `{ char: "y" }` matches each `y` of
  `"yy"`.
- **`TextInput` splits such text at its control characters.** It inserts
  each printable run whole, which is right for a paste; a `\r` submits
  what came before it, and anything after is dropped; a backspace byte
  deletes; a line feed becomes a space; any other control is dropped. So
  `"foo\r"` read in one go submits `foo`.
- **`press` and `type` cannot show it.** They write each key as its own
  chunk and settle between them, so every key meets a fresh render. The
  screen handles of `CliUiTest.render` and `CliUiTest.session` also have
  `chunk(...keys)`, which writes all the keys in one stdin read and
  settles once: that is the call that shows this bug class[^chunk-test].

## The check

A `useKeys` dispatch must step from current state, never render-closure
state. Use any of:

- a functional update, `setState((current) => step(current, action))`;
- a `useReducer` dispatch;
- a ref that the handler itself advances.

Select, MultiSelect, Confirm and TextInput use functional updates. Tabs,
which also reports each step through `onChange` and may be controlled,
advances a ref that every render re-syncs. When reviewing a new widget,
cover it with a one-chunk test of two keys: `handle.chunk("right",
"right")` from `@effected/cli/ui/testing`.

[^tabs-one-chunk-probe]: `__test__/ui/Tabs.test.ts`, "Tabs input in one chunk"
[^chunk-test]: `__test__/ui/CliUiTest.chunk.test.ts`
[^char-probe]: `__test__/ui/CliUiTest.chunk.test.ts`, "coalesced characters"; the raw probe recorded `useInput`'s `(input, key)` on fake streams
[^ink-input-parser]: Ink 7.1.1, `build/input-parser.js`, `splitBackspaceBytes`
