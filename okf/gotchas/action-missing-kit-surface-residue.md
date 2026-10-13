---
type: Gotcha
title: "\"Wait for the kit\" leaves raw spawns and duplicated regex behind"
description: An action written before a kit surface existed keeps its workaround even after the kit ships the real thing, because nothing forces a re-audit — raw git spawns and a hand-copied closes-keyword regex both outlived the packages that made them unnecessary.
status: stable
resource: ../../packages/git/src/Git.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-17T04:41:11Z
integrity:
  generated:
    body: f488352de4f6e9e7
---

# "Wait for the kit" leaves raw spawns and duplicated regex behind

## What a reader sees

An action's `src/` contains a raw `ChildProcess.Command` invocation of
`git`, or a locally-defined regular expression that matches GitHub's
"Closes #123" keyword syntax, sitting beside otherwise idiomatic
`@effected/*` code.

## What they would wrongly conclude

That this is a deliberate, still-necessary escape hatch — the kind a
genuine capability gap under [B8](../conventions/github-action-canon.md#b8-blessed-shims-live-in-srcshims)
would justify — rather than dead weight left over from before the kit
covered the case.

## What is actually true

The most-migrated of the three audited actions still carried 15 or more
raw `git` spawns and two independently drifting copies of the same
closes-keyword regular expression, discovered only by an explicit audit —
not by any compile error or test failure, because both forms typecheck
and run correctly on their own terms. Both gaps have since closed:
mutating git operations belong in [`@effected/git`](../modules/git.md),
and closes-keyword parsing belongs in
[`@effected/github-references`](../modules/github-references.md). Neither
package existed when the original workarounds were written, and nothing
about a clean build or a passing suite would have surfaced that they now
do.

## The check

Treat this as the general failure mode of "wait for the kit", not a
one-time fact about two packages: on every kit-version bump, re-audit
`src/` for raw subprocess spawns of tools the kit wraps and for
hand-written parsing logic that duplicates a kit package's grammar.
Route a genuine, currently-real gap through a
[B8 shim](../conventions/github-action-canon.md#b8-blessed-shims-live-in-srcshims)
with a tracking issue and a removal condition, and re-audit the shim
register when that issue closes — a shim with no removal condition is
indistinguishable from a workaround nobody remembers to remove.
