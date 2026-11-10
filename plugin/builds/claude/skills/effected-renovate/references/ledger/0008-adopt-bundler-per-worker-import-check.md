---
id: "0008"
title: "effected action build: a worker's own table can turn off its import check, in place of the global switch"
kind: adopt
shows: none
applies:
  "@effected/bundler": ">=0.4.0"
  "@effected/plugin": ">=0.5.1"
detect: ["^[[:space:]]*importCheck[[:space:]]*=[[:space:]]*false"]
changesets: ["bundler-action-workers", "mcp-build-lock"]
closes: ["spencerbeggs/effected#1323"]
---

Offer this to the user; never apply it unasked. It replaces `[action.build] importCheck = false`, which turned the post-build load check off for every bundle because one worker exits at import by design.

A worker can now be its own table, and its `importCheck` defaults to `true`:

```toml
[action.entries.workers.turbo-server]
source = "src/turbo-server.ts"
importCheck = false
```

1. Where the search matched `importCheck = false` under `[action.build]`, find the worker that needed it, usually named in the comment beside it.
2. Move that worker from `[action.entries.workers]`'s `name = "src/x.ts"` line to its own `[action.entries.workers.<name>]` table, with `source` and `importCheck = false`. Remove the line from the `[action.entries.workers]` table; a table that is left empty can go.
3. Delete `importCheck = false` from `[action.build]`, so `main`, `pre`, `post` and every other worker are checked again. Update any comment or OKF limitation that recorded the global switch.

A hit already inside a worker's own table is the adopted shape. Verify by running `effected action build` and confirming it passes with the check back on for the lifecycle bundles; if one of them fails to load, that is a real defect the global switch was hiding.
