---
type: Runbook
title: Enable fork pull-request review on a repository
description: Add a required-reviewer environment and a pull_request_target trigger so a repository driven by the Silk dispatcher runs full validation on fork pull requests only after a maintainer reads the diff.
status: stable
tags:
  - ci
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T22:30:14Z
  body_sha256: c2aee865987bef15d4d45af952c4559427bfebac6bf6f379a54245b9e5ed848c
---

# Enable fork pull-request review on a repository

Trigger: a repository driven by the Silk dispatcher starts receiving pull
requests from forks, and the maintainer wants those PRs to run the full
validation (check runs, Claude review) only after reading the diff.

1. Create the environment with a required reviewer:
   `gh api -X PUT repos/<owner>/<repo>/environments/fork-review --input - <<< '{"reviewers":[{"type":"User","id":<your user id>}]}'`
   (`gh api user --jq .id` gives the id).
2. Confirm the rule the dispatcher checks for:
   `gh api repos/<owner>/<repo>/environments/fork-review --jq '[.protection_rules[]?.type]'` must contain `required_reviewers`.
3. In `.github/workflows/release.yml`: add a `pull_request_target` trigger (same branches as `pull_request`, types `opened, synchronize, reopened` — never `closed`), change the concurrency group to `release-${{ github.event_name }}-${{ github.event.pull_request.number || github.sha }}`, and pass `fork-review-environment: fork-review`.
4. Merge the caller change, then open any same-repo PR: its `pull_request_target` run must show `Fork Approval` and `Fork Validation` as skipped. (The PR carrying the change itself shows no `pull_request_target` run — that event reads the workflow from the base branch.)

Done when a fork PR shows two Silk runs: `Code Validation` completing unauthenticated within minutes, and `Fork Approval` waiting with a *Review deployments* button; approving it posts the check runs on the fork commit.

Fork mode is for GitHub-hosted runners only: an approved fork run on a self-hosted runner is a persistent compromise of that runner. After approval the contributor's code can reach the App private key and the Claude tokens — the accepted residual; every other secret, the OIDC token and the caches are kept out.

Each push is a new run and needs a new approval. Branch protection's required checks are only satisfied by an approved run, so an unapproved fork PR is never mergeable.
