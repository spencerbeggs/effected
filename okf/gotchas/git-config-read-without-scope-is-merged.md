---
type: Gotcha
title: A Git config read with no scope is the merged view, not the checkout's own
description: "configGet and configList without a scope answer what git would use, not what this repository declares, so an enumerate-then-remove flow reads wider than configRemoveSection writes; configSet has no scope at all and always writes repository-local."
status: stable
resource: ../../packages/git/src/Git.ts
stale_after: "2027-03-20T00:00:00Z"
tags:
  - dx
sources:
  - id: git-service
    resource: ../../packages/git/src/Git.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 5e4ea3f339ab72ee
---

# A Git config read with no scope is the merged view, not the checkout's own

## What a reader sees

`Git.configList(cwd)` or `Git.configGet(cwd, key)` returns entries the
checkout's `.git/config` does not contain, and a flow that enumerates
sections and then calls `configRemoveSection` on each fails or removes
nothing for some of them.

## What they would wrongly conclude

That the read is wrong, or that `configRemoveSection` is silently
skipping sections.

## What is actually true

Omitting `scope` means the **merged** read — system, global and local
layered the way git itself resolves a key. That is the right answer to
"what is the effective value" and the wrong one to "what does this
checkout declare". `configRemoveSection` and `configSet` write only the
repository's own `.git/config`, so an unscoped enumerate-then-remove flow
reads wider than it writes.[^git-service]

`configGet` and `configList` take an optional `scope` of `local`,
`global`, `system` or `worktree`; `{ scope: "local" }` is the precise
read. `file` and `scope` both select a source and git accepts only one,
so passing both fails typed before any spawn.

`configSet` offers no scope. It emits a bare `git config <key> <value>`
and writes the checkout's own `.git/config`, always: a read has a
defensible "effective value" default, a write does not, and a global or
system write leaks onto a shared machine or a CI runner for every
unrelated step. The asymmetry is deliberate and is stated in the method's
TSDoc because the absence of an option is not self-explaining.

## The check

Reach for `{ scope: "local" }` whenever the question is about this
repository rather than about git's resolved answer, and never expect a
write to reach anything a scoped read did not show.

[^git-service]: `packages/git/src/Git.ts` — `configGet` and `configList`
    annotate the span with `scope: "(merged)"` when none is passed;
    `configSet` builds its argv with no scope flag.
