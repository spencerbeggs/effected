---
id: "0028"
title: "@effected/walker: a walk under matchBase reaches every file the pattern matches"
kind: behaviour
shows: behavioural
applies:
  "@effected/walker": ">=0.26.0"
detect: ["matchBase"]
changesets: ["upward-walks-find"]
closes: ["spencerbeggs/effected#1261", "spencerbeggs/effected#1283"]
---

Under `matchBase: true`, a pattern of one portion (`*.js`, `x/../*.js`) matches by basename at any depth, and a walk now reaches all of those files. It used to stop at the pattern's own depth, so `*.js` over `a.js`, `b/c.js` and `b/d/e.js` returned only `a.js`. Expect more results from such a walk, and re-check any test that pinned the shorter list.

The literal one-stat path also changed: an escaped literal (`src/\x/f.js`) finds `src/x/f.js`, and a `.` or `..` segment is never resolved through a file or a symlink, so `f.js/x/..` answers nothing at optimization level 0 and `f.js` at the default level, as glob reduces it. Verify by running the walk the consumer configures with `matchBase`. Read the installed `.d.ts` for the exact shapes.
