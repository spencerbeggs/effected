---
type: Gotcha
title: A PR's check runs post to the merge ref, not the head SHA
description: Querying GitHub check runs or conclusions scoped to a pull request's head SHA can report no failures even when a required gate actually failed, because the check posted against the merge ref instead.
status: stable
resource: ../../.github/workflows
stale_after: 2027-01-13T00:00:00Z
tags:
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 00b4ab357af1d8c1
---

# A PR's check runs post to the merge ref, not the head SHA

## What a reader sees

A script or agent queries GitHub's API for check runs on a pull request's
head commit SHA and gets back a clean list — no failing checks, or no
checks at all for the workflow in question — even immediately after a
gate is known to have run against that pull request.

## What they wrongly conclude

That the absence of a failing check scoped to the head SHA means the gate
passed, or that it never ran, when in either case the conclusion "there is
no problem here" does not follow from a query that never looked in the
right place.

## What is actually true

Some of this repository's checks post their result against the pull
request's merge ref (the synthetic `refs/pull/<n>/merge` commit GitHub
builds by merging the PR head onto its base) rather than against the head
SHA itself. A query scoped strictly to the head SHA is blind to any check
that reports there — it does not return an error, and it does not return a
failing entry; it simply never surfaces that check run at all, which reads
identically to "everything passed" even when the check genuinely failed.

## The check

Never conclude "no failures" from an absence alone. Before trusting a
head-SHA-scoped query's clean result, run a positive control: query a check
that is already known to have failed (or one known to exist for that PR)
through the same code path, and confirm the query actually surfaces it. If
the control also comes back empty, the query is scoped to the wrong ref —
check the merge ref as well as the head SHA before reporting the absence of
a failure as a passing gate.
