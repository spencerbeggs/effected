---
type: Gotcha
title: A turbo cache hit reads exactly like a fresh build in the log
description: "FULL TURBO and a clean issues.json summary print identically whether the build ran or a stale cached artifact was replayed; only `dist/<target>/issues.json`'s generatedAt distinguishes them."
status: stable
resource: ../../turbo.json
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-09-14T02:44:47Z
  body_sha256: 1006743e20584b40465fbb23ce57d4f7e03fd6c388bacb6fc0c82dbee819fbac
---

# A turbo cache hit reads exactly like a fresh build in the log

## What a reader sees

`pnpm build --filter <pkg>` prints `FULL TURBO`, the same emitted-file
count, and the same `suppressed:` figure a genuinely clean gate prints. The
log gives no visual signal distinguishing "turbo re-ran the build" from
"turbo replayed a cached artifact from before your last edit."[^turbo-json]

## What they wrongly conclude

That a clean, `FULL TURBO`-tagged build log is proof the current source
was actually compiled and gated — in particular, that an edit just made to
`src/` is reflected in `dist/<target>/` and its `issues.json`.

## What is actually true

A turbo cache hit replays the previous run's output verbatim, including
its `issues.json`. If the cache key still matches — for instance because
turbo's hash inputs missed an edit, or because the edit was made after the
cache was populated but before turbo's watch saw it — the log for a stale
artifact is indistinguishable from the log for a fresh one. The only
reliable tell is the timestamp inside the artifact itself:

```bash
node -pe "require('./dist/prod/issues.json').generatedAt"
```

`generatedAt` must postdate the last source edit under test. A replay
against genuinely unchanged inputs is legitimate, and its artifacts remain
current; a `generatedAt` predating the edit under test means the log is
reporting someone else's gate, not this one.

## The check

Before trusting a build's `issues.json` (or any gate downstream of it, such
as a suppressed-warning count), compare `generatedAt` against the mtime of
the source files the change touched. Treat a `generatedAt` that does not
postdate the edit as "this gate has not run yet," not as "the build is
clean."

[^turbo-json]: `turbo.json` — `build:prod`'s task declares `"cache": true`
    with `dist/prod/**` as its only output, so a cache hit replays that
    whole directory, `issues.json` included, without re-running the task.
