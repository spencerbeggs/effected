---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 88
related:
  - README.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/jsonc.md
---

# claude-code-marketplace-manager

## Overview

`spencerbeggs/claude-code-marketplace-manager` is a single-purpose GitHub Action: it edits a Claude Code marketplace manifest — comment-preserving JSONC — validates the result, and lands the change either directly or through a pull request.

It is the smallest consumer in the register and the only one outside the savvy-web org. Its whole interesting surface is one service, `src/services/ManifestCommitter.ts`. There is no local checkout of it at present; this record reflects the survey of 2026-08-25.

## What it exercises

**`GitBranch.upsert`, and the reason it exists.** The committer previously ran a TOCTOU dance — check existence, then create, then on failure re-check existence and reset if a concurrent run won the race — under a comment explaining that the predecessor's branch error had no structured "already exists" discriminant, so re-checking was the only robust way to tell a race from a real failure. `upsert` is one call, and `GitHubError`'s `alreadyExists` discriminant is what makes the second check unnecessary rather than merely unfashionable. The force-reset semantics the comment was defending are preserved, not traded away: a concurrent creator that rooted the branch elsewhere is still corrected.

**`GitHubRepository.defaultBranch`.** Resolving a base branch was a locally-declared octokit interface plus a `client.rest<{ default_branch }>("repos.get", …)` callback, because the predecessor's `rest()` returned `unknown`. It is now a member access.

**The branch-then-commit ordering hazard, from the consuming side.** `@effected/github` documents against `GitBranch.upsert` that resetting a branch and then committing to it closes the branch's open pull request, and names this action as the consumer that lost one to that window. The committer now builds the commit first and upserts once, straight to the finished sha. This is the register's clearest case of a hazard that produces no compile error and is only found in production.

**Comment-preserving JSONC editing.** `Jsonc.parse` → `JsoncModifier.modify` → `JsoncEdit.applyAll`, with a surviving comment as a pinned test. Already the kit's answer before the action migration, and untouched by it.

## Where the kit's edge sits

- **Structural validation stays local.** `src/services/ManifestValidator.ts` runs Ajv against a bundled JSON Schema alongside Effect Schema decoders. No kit package offers this pairing; it is not a kit concern.
- **Marketplace-manifest vocabulary** — the schemas, the report shaping and the persisted state.
- **The JSON Schema generation script**, which derives schema files from the repo's own Effect Schemas and drift-checks the committed copies.

## Open questions

1. **`resolveBaseBranch` gained a type and did not gain a test.** The cast it used to carry could never have been validated against the real octokit shape, because the predecessor's client double keyed on an operation-name string and ignored the callback entirely. A typed member removes the cast; the missing test is a separate gap and still open on the consumer's side.
