---
type: Gotcha
title: An unprotected environment runs fork code with secrets
description: A fork PR's Fork Approval job can start immediately without a Review deployments prompt and then fail with "has no required-reviewers rule" — GitHub auto-creates an environment with no protection rules the first time any workflow references its name, so the dispatcher verifies required_reviewers itself before handing fork code the App token and Claude OAuth token.
status: stable
resource: ../../.github/workflows/release.yml
stale_after: 2027-09-13T00:00:00Z
tags:
  - ci
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T22:04:49Z
  body_sha256: f6993f1c304568c9d659482bb14e3d1048915e30e34c22a60f6d6284ee82a5fe
---

# An unprotected environment runs fork code with secrets

## What a reader sees

`fork-review-environment` is set in the caller and a fork PR's `Fork Approval`
job starts immediately, without a *Review deployments* prompt — then fails with
"has no required-reviewers rule".

## What they wrongly conclude

That the dispatcher is broken, or that approval is optional and the failure can
be ignored.

## What is actually true

GitHub creates an environment with no protection rules the first time any
workflow references its name. Had the dispatcher trusted the `environment:`
binding alone, the fork's code would have run with the App token and Claude
OAuth token with nobody approving. The `fork-approval` job therefore reads the
environment's `protection_rules` through the API and refuses to hand off unless
`required_reviewers` is present. The fix is on the repository, not the
workflow: add a required reviewer (see the
[enable-fork-pull-request-review](../runbooks/enable-fork-pull-request-review.md)
Runbook) and re-run.
