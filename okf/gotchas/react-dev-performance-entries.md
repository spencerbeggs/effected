---
type: Gotcha
title: React 19's development build leaks user-timing entries on every render
description: "Unless NODE_ENV is exactly production, React 19 records about 15 performance measure entries per rerender and never clears them, so a long-lived Ink view grows the heap (76 MB against 7.7 MB over 20 000 rerenders); an unset NODE_ENV and Vitest's test both leak, and the only drain, clearMeasures(), is global."
status: draft
resource: ../../docs/superpowers/specs/2026-10-01-p5-probes.md
stale_after: "2027-04-01T00:00:00Z"
tags: [performance, compat]
sources:
  - id: p5-probes
    resource: ../../docs/superpowers/specs/2026-10-01-p5-probes.md
    title: "P5 planning probe L3: React 19 performance-entry growth, on node 24.11.0 and 26.10.0"
  - id: react-entry
    resource: "npm:react@19.3.0"
    title: "react/index.js:3 and react-reconciler/index.js:3 pick the development build when NODE_ENV !== production"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T09:47:15Z
  body_sha256: c0285b125958b2ee47abc62fb542a3a0880986cb64a2abaa870ff0d56052c86f
---

# React 19's development build leaks user-timing entries on every render

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
Probe L3 counted them on Node 24 and 26 alike:[^p5-probes]

- about **15 measure entries per rerender**: 17 after one, 1502 after 100,
  30 002 after 2000; marks stayed at 0;
- over 20 000 rerenders, **76.0 MB of heap growth with no drain against
  7.7 MB with one**, after 80 005 entries;
- an **unset** `NODE_ENV`, the common CLI case, leaks exactly as
  `development` does, and so does Vitest's `test`;
- `renderToString` adds about 2.3 entries per call.

Clearing after every render (`performance.clearMeasures()`) holds the count
at 0. That call takes no filter by `detail`, and clearing by name would hit
any user measure named `Update` or `Mount`, so the drain is global: it also
clears a consumer's own user-timing entries.

## What to do

Drain after every rerender, the final unmount and every `renderToString`,
unconditionally rather than gated on `NODE_ENV === "production"`, and
document the drain as global. Drain long-lived `CliUi.run` screens too, not
only live views: a screen left open re-renders on every key and resize.

[^p5-probes]: `docs/superpowers/specs/2026-10-01-p5-probes.md`, section L3
[^react-entry]: `npm:react@19.3.0`, `index.js:3`, and `npm:react-reconciler`, `index.js:3`
