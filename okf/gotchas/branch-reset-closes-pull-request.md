---
type: Gotcha
title: Resetting a branch to its pull request's base closes that pull request
description: GitBranch.upsert's reset path makes a branch's head equal its pull request's base, and GitHub auto-closes any pull request whose diff goes empty as a result — even when a follow-up commit was already planned to re-add content.
status: stable
resource: ../../packages/github/src/GitBranch.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 6375701b67552d79
---

# Resetting a branch to its pull request's base closes that pull request

## What a reader sees

Code calls `GitBranch.upsert(branch, targetHead)` to reset an existing
branch to a target commit — say, back to `main`'s current head — intending
to follow it a few seconds later with a new commit that re-adds content.
The reset call succeeds. Shortly after, the branch's open pull request
shows as closed, with no error reported anywhere in the calling code.

## What they would wrongly conclude

That the pull request closed for an unrelated reason, or that something
external interfered, since the reset call itself reported success and the
plan to re-add content immediately afterward seemed to make the closure
window irrelevant.

## What is actually true

A reset is observable, and GitHub's own pull-request lifecycle reacts to
it. `upsert(branch, targetHead)` resets rather than inheriting a branch a
concurrent creator rooted somewhere else — the correct recovery semantics
for a race — but when that reset target equals the pull request's base,
the branch's head becomes equal to its base, and GitHub auto-closes any
pull request whose diff is empty at that moment. This happened in
practice: a consumer ran `upsert(releaseBranch, mainHead)` intending to
re-add content with a commit roughly three seconds later, and GitHub
closed the open release pull request inside that window while the overall
run still reported success — the closure landed silently in a gap between
two calls that each succeeded individually.

## The check

Treat any `GitBranch.upsert` call whose target head could equal an open
pull request's base as capable of closing that pull request, regardless
of how quickly a follow-up commit is planned. Where the branch must stay
open across a reset-then-recommit sequence, reopen the pull request
explicitly after the follow-up commit lands, or restructure the sequence
so the branch's diff against its base is never empty at any point GitHub
observes it.[^git-branch]

[^git-branch]: `packages/github/src/GitBranch.ts:50-70` — the `upsert`
    doc comment states the reset-then-auto-close mechanism and the
    ~3-second race window a real consumer hit.
