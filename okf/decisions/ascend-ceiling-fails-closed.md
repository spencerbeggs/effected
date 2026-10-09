---
type: Decision
title: The ascend ceiling compares resolved paths and rejects a relative stopAt as a defect
description: Walker's ascend ceiling normalizes both sides before comparing and dies on a relative stopAt, closing a fail-open bug where an unnormalized ceiling silently let the scan reach the filesystem root.
status: stable
tags:
  - architecture
sources:
  - id: walker-claude-md
    resource: ../../packages/walker/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 73b16b9eff4ed81108cd8ba9bb30c7f24df197966eb7eb329f9cc23dcc3f7e6c
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
---

# The ascend ceiling compares resolved paths and rejects a relative stopAt as a defect

## Context

`Walker.ascend`'s `stopAt` option bounds an upward traversal. An earlier
version compared the ceiling against each ascended directory with raw
string equality. An unnormalized ceiling — one containing a `.` segment
or a trailing separator inconsistency with the chain being walked —
matched nothing, so the ascent silently ran all the way to the
filesystem root: the exact unbounded walk `stopAt` exists to prevent,
with no error raised to notice it by. This is a **fail-open** bug class:
the guard looked present in the code while doing nothing at runtime.

## Decision

`stopAt` is compared in **resolved form on both sides**, and the
comparison stays **inclusive** of the named ceiling directory itself.
Both the ceiling and each ascended directory go through `Path.resolve`
before comparison, because normalizing only the ceiling would
desynchronize it from an unnormalized chain element — `/a/b/.` names
`/a/b`, and comparing a resolved ceiling against an unresolved chain
element would silently reintroduce the same class of miss. Normalization
governs the **comparison only**: the chain the function returns stays
the lexical one derived from the start directory, because rewriting it
would break the lexical contract for every caller passing no ceiling at
all.

A **relative** `stopAt` is rejected as a **defect**, never resolved
against `process.cwd()` and never turned into a typed failure. Two
reasons:

- Resolving it against `process.cwd()` would let the same ceiling string
  name different directories depending on where the process happens to
  run from — a lint-staged hook, a CLI invoked from a package directory,
  and a test runner would each silently pick a different real ceiling.
  This is the fail-open class again, through a different door.
- A typed rejection would be **swallowed** by every absorbing caller.
  config-file's resolver contract absorbs every typed failure into
  `Option.none()`, so a typed ceiling error would re-emerge as a
  clean-looking "no config found" instead of surfacing the wiring
  mistake. `Effect.catch` does not catch defects, so only a defect
  survives that absorption path.

Only the ceiling is constrained this way — a relative *start* directory
still ascends to the relative root, since absoluteness there is judged
purely by the injected `Path` implementation (a win32 layer accepts
`C:\repo` as absolute).

## Alternatives rejected

- **Compare `stopAt` with raw string equality.** Rejected: this is the
  original fail-open bug, silently degrading a bounded walk into an
  unbounded one.
- **Resolve a relative `stopAt` against `process.cwd()`.** Rejected: it
  reintroduces environment-dependence into what should be a pure,
  reproducible comparison, and a config-discovery caller run from
  different working directories would silently ascend to different
  ceilings.
- **Make a relative `stopAt` a typed failure instead of a defect.**
  Rejected: config-file's absorbing resolver contract would swallow it
  into a false "no config found", hiding the wiring mistake rather than
  surfacing it.

## Consequences

Never "upgrade" the relative-`stopAt` guard to a typed error — doing so
reopens exactly the silent-wrong-answer failure the defect classification
exists to close. A test reconstructing the absorbing config-file caller
is the pinning mechanism for this guarantee, since only that
reconstruction proves the defect actually survives the absorption layer
above it.
