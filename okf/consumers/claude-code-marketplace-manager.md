---
type: Consumer
title: claude-code-marketplace-manager
description: "A single-purpose GitHub Action outside the savvy-web org that edits a Claude Code marketplace manifest's comment-preserving JSONC and lands the change directly or via pull request."
repository: spencerbeggs/claude-code-marketplace-manager
status: stable
tags: [ci]
generated:
  by: okfit/claude-code
  at: 2026-09-13T05:33:04Z
sources:
  - id: repo
    resource: "https://github.com/spencerbeggs/claude-code-marketplace-manager"
integrity:
  generated:
    body: 04f3a1f8318fc866
---

# claude-code-marketplace-manager

`spencerbeggs/claude-code-marketplace-manager` is a single-purpose GitHub
Action: it edits a Claude Code marketplace manifest — comment-preserving
JSONC — validates the result, and lands the change either directly or
through a pull request.

It is the smallest consumer in the register and the only one outside the
savvy-web organization. Its whole interesting surface is one service, a
manifest committer, reaching [`@effected/github`](../modules/github.md),
[`@effected/github-actions`](../modules/github-actions.md) and
[`@effected/jsonc`](../modules/jsonc.md). There is no local checkout of it;
this record reflects the survey of 2026-08-25, and has not been re-verified
against a live `package.json` since.

## What it exercises

**Branch upsert, and the reason it exists.** The committer previously ran a
check-existence-then-create-then-re-check-on-failure dance, under a comment
explaining that the predecessor's branch error had no structured
"already exists" discriminant, so re-checking was the only robust way to
tell a race from a real failure. The kit's
[branch-upsert call](../interfaces/github-resources.md) is one call, and
its `GitHubError` "already exists" discriminant is what makes the second
check unnecessary rather than merely unfashionable. The force-reset
semantics the comment was defending are preserved, not traded away: a
concurrent creator that rooted the branch elsewhere is still corrected.

**Default-branch resolution as a member access.** Resolving a base branch
was a locally-declared octokit interface plus a cast callback, because the
predecessor's raw REST call returned `unknown`. It is now a typed member
access on the kit's [repository resource](../interfaces/github-resources.md).

**The branch-then-commit ordering hazard, from the consuming side.**
[`@effected/github`](../modules/github.md) documents against its
branch-upsert call that resetting a branch and then committing to it closes
the branch's open pull request, and names this action as the consumer that
lost one to that window. The committer now builds the commit first and
upserts once, straight to the finished sha. This is the register's clearest
case of a hazard that produces no compile error and is only found in
production.

**Comment-preserving JSONC editing.** Parse, then modify, then apply edits,
with a surviving comment as a pinned test. Already the kit's answer before
this action's migration onto the kit, and untouched by it.

## Where the kit's edge sits

- **Structural validation stays local.** A manifest-validator service runs
  Ajv against a bundled JSON Schema alongside Effect Schema decoders. No
  kit package offers this pairing; it is not a kit concern.
- **Marketplace-manifest vocabulary** — the schemas, the report shaping and
  the persisted state.
- **The JSON Schema generation script**, which derives schema files from
  the repository's own Effect Schemas and drift-checks the committed
  copies.

## Open questions

1. **Default-branch resolution gained a type and did not gain a test.**
   The cast it used to carry could never have been validated against the
   real octokit shape, because the predecessor's client double keyed on an
   operation-name string and ignored the callback entirely. A typed member
   removes the cast; the missing test is a separate gap and still open on
   the consumer's side.
