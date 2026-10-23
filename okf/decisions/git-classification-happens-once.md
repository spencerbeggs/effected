---
type: Decision
title: Git failure classification happens once, in one private function
description: No consumer of @effected/git ever string-matches stderr; a single private classify step in Git.ts is the only place that inspects stderr, stdout or exitCode.
status: stable
tags:
  - architecture
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 8e9b17588c6e7381
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 036ea2e7257d23de
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# Git failure classification happens once, in one private function

## Context

git communicates failure through exit codes and unstructured stderr text.
Every consumer of a git-spawning library that has to interpret that text
itself risks re-deriving — and re-getting-wrong — the same classification
logic, and a change to git's own wording can silently break every
independent implementation at once.

## Decision

No consumer of `@effected/git` ever string-matches stderr. Git's failure
modes are classified in a single private `classify` step in `Git.ts` —
nowhere else in the package inspects `stderr`, `stdout` or `exitCode`.
The base taxonomy is three typed errors carried through every surface the
service has:

- **`GitCommandError`** — git ran and failed in a way that is not a
  recognized domain case, the spawn itself failed, or a pre-spawn guard
  refused the invocation. A required `kind` discriminant
  (`"refused" | "failed"`) splits pre-spawn refusals from genuine git
  failures structurally, so composed retry/fallback logic routes on
  `kind` rather than parsing the `detail` prose.
- **`NotARepositoryError`** — the `cwd` is not inside a git work tree.
  Every consumer branches on this, so it is a distinct tag rather than a
  `GitCommandError` a caller regex-matches.
- **`UnknownRefError`** — the ref does not resolve. Actionable and
  user-facing, so it is distinct from mechanics; the ref-fetching trio's
  failures land here typed, which is the signal `fetchAny`'s
  tag-then-plain fallback branches on.

Three more errors exist on the rule that **a typed error exists only
where a consumer branches**, each raised only by the members introduced
with it: `NonFastForwardError` (`push` rejected because the remote
moved), `DirtyWorktreeError` (git refused before touching anything) and
`MergeConflictError` (git wrote conflict markers). These three are
kind-gated, so adding them changed no other member's error union —
`checkout` failing on dirty-worktree stderr still surfaces as
`GitCommandError`, pinned by a regression test rather than by intent.

`classify` is gated by a `ClassifyKind` selecting which method-specific
rows apply on top of the shared taxonomy (`exitCode === 0` is success,
`"not a git repository"` is `NotARepositoryError`, an unknown-revision
phrase is `UnknownRefError`, anything else non-zero is `GitCommandError`
with `exitCode` and `stderr`). What each kind buys, and which members ride
it:

| kind | members | the row it enables |
| --- | --- | --- |
| `"show"` | `show` | an absent-at-ref phrase degrades to `Option.none()` |
| `"refExists"` | `refExists` | exit 1 is `false`, and so is `unknownRef` — the contract is "does this resolve", so an unrecognized ref syntax must not throw |
| `"quiet"` | `defaultBranch`, `configGet`, `configGetAll`, `checkIgnore`, `mergeBaseOption` | a **silent** exit 1 is absence (`Option.none()` or `[]`); exit 1 with any stderr text stays a real failure |
| `"noSuchRemote"` | `remoteUrl` | `"No such remote"` degrades to `Option.none()` |
| `"push"` | `push` | `[rejected]` together with `non-fast-forward`, `fetch first` or `stale info` is `NonFastForwardError`; git 2.54's remote-moved wording is `fetch first`, not the classic phrase, and the `--force-with-lease` lease failure is `stale info` |
| `"merge"` | `pull`, `stashPop`, `stashApply` | `would be overwritten by` on stderr is `DirtyWorktreeError`; `CONFLICT (`, `Automatic merge failed` or `could not apply` is `MergeConflictError` — the one place `classify` reads **stdout**, because git's merge machinery reports conflicts there while a rebase-mode pull's `could not apply` lands on stderr |
| `"log"` | `log` | an unborn HEAD (`does not have any commits yet`) is the empty listing — scoped to `log` because for every other member an unborn HEAD is a real failure |
| `"generic"` | everything else | none |

`mergeBase` deliberately stays `"generic"` while `mergeBaseOption` is
`"quiet"`: disjoint histories exit 1 silently, and the loud failure is the
contract `mergeBase`'s existing consumers depend on, so the one argv backs
both members. `"couldn't find remote ref"` sits in the unknown-ref
patterns for every member, though only `fetch`, `submoduleUpdate` and
`submoduleAdd` produce it. The two-ref members, `mergeBase` and
`changedFiles`, report `UnknownRefError` with `ref` set to the `"a...b"`
range label rather than either ref alone.

Both `PlatformError` and `Cause.TimeoutError` are absorbed inside
`runClassified` — a spawn-level failure becomes a `GitCommandError` with
`detail` set and no `exitCode`, and the 30-second `GIT_TIMEOUT` becomes
one with `detail: "timed out after 30s"` — so a `Git` method's error
channel only ever sees this package's own typed errors, never core's raw
plumbing. `log` is the one member whose parser can fail: every other
parser is total, but two ISO dates must decode and a record short of its
declared fields cannot be answered plausibly, so `parseLog` returns a
`Result` and both shapes surface as a `GitCommandError` with `detail`,
never a defect.

The stderr matching itself is unanchored substring matching against
`LC_ALL=C`-pinned phrases, an accepted, recorded tradeoff — a path or ref
name that literally contains one of these phrases could theoretically
misclassify, and anchoring is deferred until a real collision is
observed.

## Alternatives rejected

**Let each consumer classify git's stderr for its own needs.**
Rejected because it is the exact failure mode this package exists to
prevent: `@effected/workspaces`' snapshot reader, and every other
consumer spawning `git` directly, would each independently interpret
exit codes and stderr text, and a wording change in a future git release
would silently break every one of them differently.

**One flat `GitError` class with a string `reason`.** Rejected for the
same reason the kit's [per-reason tagged error
decision](github-actions-per-reason-tagged-errors.md) applies elsewhere:
a caller plausibly recovers from `NonFastForwardError` differently than
from `DirtyWorktreeError`, and collapsing them into one class with a
string discriminant removes `catchTag`'s ability to route on the
distinction structurally.

## Consequences

Adding a new typed error must ship with a control test: a test asserting
the error fires on its own member, and a control asserting another
member fed the identical stderr still fails generically — without the
control, kind-gating is an intention rather than a guarantee. Widening an
existing member's typed errors is a silent breaking change to every
`catchTag` written against it, so a new error tag is scoped as narrowly
as the member that needs it.
