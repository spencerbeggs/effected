---
type: Gotcha
title: React 19's development reconciler leaked user-timing entries on every render, until react-reconciler 0.34
description: "Unless NODE_ENV is exactly production, react-reconciler 0.33 (Ink 7) recorded about 15 performance measure entries per rerender and never cleared them, growing a long-lived view's heap; 0.34, which Ink 8 requires, clears each measure as it records it, so the kit's global drainPerformance is now a proven no-op, kept for API stability. A Vitest worker hides either behaviour because its console has no timeStamp."
status: draft
resource: ../../packages/cli/src/ui/internal/perfDrain.ts
stale_after: "2027-04-01T00:00:00Z"
tags: [performance, compat]
sources:
  - id: drain
    resource: ../../packages/cli/src/ui/internal/perfDrain.ts
    title: "The drain: performance.clearMeasures() after every render, and the reason it is global"
  - id: drain-test
    resource: ../../packages/cli/__test__/ui/perfDrain.test.ts
    title: "The drain test: a Vitest worker records no entries until console.timeStamp is installed"
  - id: react-entry
    resource: "npm:react@19.3.0"
    title: "react/index.js:3 and react-reconciler/index.js:3 pick the development build when NODE_ENV !== production"
  - id: reconciler-clears
    resource: "npm:react-reconciler@0.34.0"
    title: "cjs/react-reconciler.development.js: each of its 8 performance.measure calls is followed by performance.clearMeasures; 0.33.0 has none"
  - id: ink-pins-reconciler
    resource: "npm:ink@8.0.0"
    title: "package.json: react-reconciler ^0.34.0 (Ink 7.1.1 had ^0.33.0)"
generated:
  by: "okfit/claude-code"
  at: 2026-10-07T21:32:23Z
  body_sha256: c13cdb104315527370dc649115364cfd52a7d06d243b2d3f78315272425e8973
---

# React 19's development reconciler leaked user-timing entries on every render, until react-reconciler 0.34

## Where it stands

react-reconciler 0.34 pairs every `performance.measure` it makes with a
`performance.clearMeasures` of the same name,[^reconciler-clears] and Ink 8
depends on `^0.34.0`,[^ink-pins-reconciler] so on any Ink the kit's `^8.0.0`
peer admits, nothing piles up. A plain-Node probe over 200 rerenders left 804
measures on Ink 7.1.1 and 0 on Ink 8. The drain test now pins that: a spy shows
React recording measures and none being left without the drain.[^drain-test]
`LiveOptions.drainPerformance` stays, a no-op on that path, for API stability;
removing it is a public-surface change for its own release. What follows is
the leak as it was on react-reconciler 0.33, which a program bringing its own
older reconciler could still meet.

## What you see

A long-lived Ink view (a live reporter, a screen left open) looks healthy:
frames paint, nothing errors. Its heap grows steadily. A program run with
`NODE_ENV=production` shows none of it, so the leak looks like something in
the program rather than in React.

## What you will wrongly conclude

That the view is fine because nothing fails, or that the leak only happens
in development tooling, since a CLI rarely sets `NODE_ENV=development`.

## What is actually true

React picks its development build whenever `NODE_ENV` is not exactly
`production`,[^react-entry] and that build records user-timing `measure`
entries (`Update`, `Mount`, tagged `detail.devtools`) that nothing clears.
A probe counted them on Node 24.11.0 and 26.10.0 alike (the figures below are that measurement, taken with React 19.3.0, and the drain test pins the mechanism):[^drain]

- about **15 measure entries per rerender**: 17 after one, 1502 after 100,
  30 002 after 2000; marks stayed at 0;
- over 20 000 rerenders, **76.0 MB of heap growth with no drain against
  7.7 MB with one**, after 80 005 entries;
- an **unset** `NODE_ENV`, the common CLI case, leaks exactly as
  `development` does, and so does Vitest's `test`;
- React also checks, once as its reconciler loads, that `console.timeStamp`
  is a function (`supportsUserTiming`). Node's console has it; a Vitest
  worker's console does not, so **inside a Vitest worker nothing is
  recorded** and a leak test there passes vacuously unless it installs
  `console.timeStamp` before Ink is imported. A reporter in Vitest's main
  process runs on Node's console and leaks;[^drain-test]
- `renderToString` adds about 2.3 entries per call.

Clearing after every render (`performance.clearMeasures()`) holds the count
at 0. That call takes no filter by `detail`, and clearing by name would hit
any user measure named `Update` or `Mount`, so the drain is global: it also
clears a consumer's own measures. Leave marks alone: React leaks measures
only, so `clearMarks()` would take nothing of React's and only a host's own
marks.

## What to do

On Ink 8, nothing: the reconciler clears its own measures. For a reconciler
that leaks, the drain is the answer: drain after every rerender, the final unmount and every `renderToString`,
unconditionally rather than gated on `NODE_ENV === "production"`, and
document the drain as global; clear measures, never marks. Drain long-lived `CliUi.run` screens too, not
only live views: a screen left open re-renders on every key and resize.

[^drain]: `packages/cli/src/ui/internal/perfDrain.ts`, the drain, with its mode decision (`auto` drains unless `NODE_ENV` is exactly `production`)
[^drain-test]: `packages/cli/__test__/ui/perfDrain.test.ts`, which installs the `console.timeStamp` gate a worker lacks, then spies on `performance.measure` to prove React recorded, and asserts none are left
[^react-entry]: `npm:react@19.3.0`, `index.js:3`, and `npm:react-reconciler`, `index.js:3`
[^reconciler-clears]: `npm:react-reconciler@0.34.0`, `cjs/react-reconciler.development.js`
[^ink-pins-reconciler]: `npm:ink@8.0.0`, `package.json`
