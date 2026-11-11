---
id: "0004"
title: "@effected/bundler: an ActionEntries.workers value is a string or an ActionWorker table"
kind: breaking
shows: typed
applies:
  "@effected/bundler": ">=0.4.0"
detect: ["ActionEntries"]
changesets: ["bundler-action-workers"]
closes: ["spencerbeggs/effected#1323"]
---

This applies only to TypeScript that reads `@effected/bundler`'s decoded action config. An `effected.toml` needs no change: a worker written as `name = "src/x.ts"` is still valid.

`ActionEntries.workers` widens from a record of strings to a record of `string | ActionWorker`, so a worker can be its own table, `[action.entries.workers.<name>]`, with `source` and `importCheck`. Code that reads a worker value as a string fails to typecheck. Narrow it first: a string is the source, and an `ActionWorker`'s source is its `source` field.

Read the installed `.d.ts` for `ActionWorker` and `ActionEntries`. Verify with the typecheck. For the new per-worker `importCheck`, see the adopt entry.
