---
type: Gotcha
title: A vitest positional filter is a cwd-rendered substring match, and a miss collects nothing
description: "A vitest positional filter is not a package or directory selector -- it substring-matches each test file's path as rendered from the current working directory, so the same filter can select the whole repo, one package, or nothing depending on where it is invoked from."
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
  at: 2026-09-14T02:44:47Z
  body_sha256: 4a4572cb59dbc6091574851ab8be07fc9ec8205f7e120cb16776a55f03cbfa95
---

# A vitest positional filter is a cwd-rendered substring match, and a miss collects nothing

## What a reader sees

Running `vitest run packages/lockfiles` from the repository root collects
and runs the `@effected/lockfiles` suite as expected. Running the exact
same command from inside `packages/lockfiles` reports `Tests: 0/0
passed` and exits 1 — no files collected, no error message naming what
went wrong.

## What they wrongly conclude

That the positional argument is a path to a package or directory, so the
same argument should behave the same way regardless of where the command
is invoked from — and that a `0/0` result with exit 1 means either "there
really are no matching tests" or "the config is broken," rather than "the
filter matched nothing from here."

## What is actually true

Vitest resolves its config by walking up from the invoking `cwd`, so the
project root itself is not cwd-sensitive — `vitest run` with no
positional filter runs the whole repository from anywhere.[^vitest-config]
A **positional** filter, however, is matched as a plain substring against
each candidate test file's path **as rendered relative to the cwd it was
invoked from**, not as a path selector:

```text
# from inside packages/lockfiles:
vitest run                                  -> the WHOLE repo, exit 0
vitest run --project @effected/lockfiles    -> 143/143, exit 0
vitest run packages/lockfiles               -> 0/0 collected, exit 1
vitest run __test__                         -> the WHOLE repo, exit 0
```

`packages/lockfiles` matches file paths rendered from the repo root
(`packages/lockfiles/__test__/...`) but matches nothing when the same
paths render relative to `packages/lockfiles` itself
(`__test__/...`). `__test__` matches everywhere, because every package's
tests live under that literal directory name. A miss produces `Tests:
0/0 passed` with no distinguishing signal from "there are genuinely no
tests here" — read a `0/0` result as "the filter did not match," not as
an empty suite, before trusting the exit code.

## The check

Prefer `vitest run --project @effected/<pkg>` (or the equivalent `--project
<name>` for a non-package project such as `scratchpad`), which resolves
against the config root rather than the cwd and works identically from
any directory. Treat a positional filter as fragile by construction: if
one is used, confirm the `Tests:` line reports a non-zero count before
trusting the exit code, since a `0/0` collection and a "nothing failed"
result both exit 0 or 1 in ways that look alike.

[^vitest-config]: `vitest.config.ts` — the inline comment on `globalSetup`
    documents the exact four-command comparison above, measured from
    inside `packages/lockfiles`.
