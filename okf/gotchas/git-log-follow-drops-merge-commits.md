---
type: Gotcha
title: git log --follow is not the unfollowed walk plus more
description: "--follow linearizes history and drops merge commits, so a followed and an unfollowed walk over the same path can have the same length; a test comparing their lengths cannot fail for the right reason."
status: stable
stale_after: "2027-03-20T00:00:00Z"
tags:
  - testing
sources:
  - id: git-surface-int-test
    resource: ../../packages/git/__test__/integration/GitSurface.int.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 4c6fda2e4d1aac27
---

# git log --follow is not the unfollowed walk plus more

## What a reader sees

A test asserting that `Git.log(cwd, { paths, follow: true })` returns
more entries than the same call without `follow` passes on one fixture
and fails on another, or passes without exercising the rename at all.

## What they would wrongly conclude

That `--follow` simply extends the walk across the rename, so "more
entries" is the property to pin.

## What is actually true

`--follow` linearizes history and **drops merge commits** (probed against
git 2.54), so the followed walk gains the pre-rename commits and loses the
merges. The two walks can be the same length and only their contents
discriminate; a length comparison is a test that cannot fail for the
right reason.[^git-surface-int-test]

This is why `log` has its own integration fixture. It is the only `Git`
member whose answer depends on the shape of history rather than one tree,
so its fixture carries a rename across the scoped path, an off-pathspec
commit and a real conflicted-then-resolved merge — what makes `--follow`
and `--diff-merges=first-parent` falsifiable at all. A mock spawner can
pin the parser; only real git can tell whether `--follow` walked the
rename.

## The check

Assert on the shas or paths a walk contains, never on how many entries it
has relative to another walk.

[^git-surface-int-test]: `packages/git/__test__/integration/GitSurface.int.test.ts`
    — the fixture C describe block and its history diagram.
