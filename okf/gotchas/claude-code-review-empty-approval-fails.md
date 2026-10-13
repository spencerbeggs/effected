---
type: Gotcha
title: The required Claude Code Review check fails on an empty-body approval
description: This repository's REQUIRED "Claude Code Review" check reports failure with "Review produced no comment" whenever the reviewer approves a pull request with an empty review body, deterministically and on every release PR too.
status: stable
resource: ../../.github
stale_after: 2027-01-13T00:00:00Z
tags:
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 7c92b4ac9998ab22
---

# The required Claude Code Review check fails on an empty-body approval

## What a reader sees

A pull request's "Claude Code Review" check — configured as a required
status check for merge — shows a red X with the message "Review produced
no comment," even though the review that ran actually approved the change.
Re-running the check produces the identical failure.

## What they wrongly conclude

That the review genuinely failed to run, that the pull request has an
unresolved problem the reviewer flagged, or that re-triggering the check
(pushing an empty commit, re-requesting review, re-running the workflow)
will produce a passing result.

## What is actually true

The failure is deterministic, not transient: whenever the reviewer's
verdict is an approval with an empty review body — no comment text
attached to the approval — the check's own reporting step treats "no
comment produced" as a failure condition rather than as a legitimate silent
approval. Re-running never helps, because the same empty-body approval
recurs every time the review re-runs against unchanged content that merits
no comment. The failure is not scoped to ordinary feature branches — it
blocks release pull requests exactly the same way, which makes it capable
of stalling a release train on a check that has nothing substantive to
report.

## The check

Do not treat this failure as evidence of a real review finding. Confirm
first that the underlying review's verdict was actually an approval with
no comment body (not a rejection or a genuine finding the check is
correctly surfacing) before deciding the red check is spurious. Because
re-running does not clear it, the pull request needs either a substantive
review comment on the same pass, or a human override of the required-check
gate — there is no retry path that resolves it on its own.
