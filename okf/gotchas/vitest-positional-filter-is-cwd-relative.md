---
type: Gotcha
title: A vitest positional filter is a substring match, and a run from inside a package never loads the root config
description: "A vitest positional filter is not a package or directory selector -- it substring-matches each test file's path. Run from inside a package, vitest does not load the root config at all, so --project matches no project and a root-relative positional filter finds no files."
status: stable
resource: ../../vitest.config.ts
stale_after: 2027-03-13T00:00:00Z
tags:
  - testing
  - dx
sources:
  - id: vitest-config
    resource: ../../vitest.config.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T05:32:50Z
  body_sha256: 7874cb63abd9e16ecd2fbb9575cd0f17aa11b79c3405ae4efdc408c5bd887fa3
---

# A vitest positional filter is a substring match, and a run from inside a package never loads the root config

## What a reader sees

Running `vitest run packages/lockfiles` or `vitest run --project
@effected/lockfiles` from the repository root runs the `@effected/lockfiles`
suite. Running either from inside `packages/lockfiles` fails: the positional
form prints `No test files found, exiting with code 1`, and the `--project`
form stops with `Startup Error: No projects matched the filter
"@effected/lockfiles"`.

## What they wrongly conclude

That vitest walks up from the cwd to the root config, so `--project` works
from any directory and only a positional filter is cwd-sensitive; or that a
positional argument is a path to a package, so it should behave the same
wherever it is invoked.

## What is actually true

Vitest does not walk up to find the root `vitest.config.ts`.[^vitest-config]
Invoked from inside a package it runs with that directory as its root and no
repo config: no projects, no `globalSetup`, no plugins, and vitest's default
reporter instead of the vitest-agent one.

```text
# from inside packages/lockfiles:
vitest run                                                    -> the package's 7 files, default reporter, exit 0
vitest run --project @effected/lockfiles                      -> Startup Error: No projects matched the filter, exit 1
vitest run packages/lockfiles                                 -> No test files found, exit 1
vitest run --config ../../vitest.config.ts --project @effected/walker -> green, exit 0
# from the repo root:
vitest run --project @effected/lockfiles                      -> 143/143, exit 0
vitest run ckfiles                                            -> 143/143, exit 0
vitest run zzz-no-such-filter                                 -> Tests: 0/0 passed, exit 1
```

A **positional** filter is matched as a plain substring against each test
file's path, not as a path selector: `ckfiles` is neither a path nor a whole
segment, and it selects the lockfiles suite. A filter that matches nothing
prints `Tests: 0/0 passed` and exits 1 — the summary line says passed while
the exit code says failed.

## The check

Run vitest from the repository root, and prefer `vitest run --project
@effected/<pkg>` (or `--project scratchpad`). When you must stay in a package
directory, pass `--config` pointing at the root config. Read both the `Tests:`
line and the exit code; a `0/0` line means the filter matched nothing.

[^vitest-config]: `vitest.config.ts` — the inline comment on `globalSetup`
    records the same comparison.
