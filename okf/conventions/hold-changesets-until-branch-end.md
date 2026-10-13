---
type: Convention
title: Write changesets once, at branch finalization, never per round
description: Reconcile a branch's changesets in a single pass when the work concludes, instead of adding or editing one after every incremental round of changes.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - release
  - dx
sources:
  - id: claude-md
    resource: ../../CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 930cc944e549bb94
---

# Write changesets once, at branch finalization, never per round

Hold changeset authoring until a branch or loop actually finishes, and do
one reconciliation pass at that point rather than writing or amending a
changeset after every incremental round of work on the
branch.[^claude-md] A
mid-branch changeset describes work that may still be revised, reverted,
or reshaped before the branch lands, so writing one early produces a
changelog entry that has to be re-checked and often rewritten anyway once
the branch's final shape is known.

This is a judgement CI does not enforce for you: the Stop-time
missing-changeset note some tooling surfaces is addressed to a human
reviewing the finished branch, not to an agent mid-task, and no hook blocks
a commit or a branch for lacking a changeset yet. A missing changeset is a
human call to make on the pull request, not a gate an agent should try to
satisfy prematurely by writing one before the branch's scope has settled.

[^claude-md]: `CLAUDE.md` — "Releases are changeset-driven: CI builds the
    changesets and releases the packages they name," read together with
    the repository's practice of a single reconciliation pass rather than
    a changeset per round.
