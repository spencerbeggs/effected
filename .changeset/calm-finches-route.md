---
"@effected/github": patch
---

## Bug Fixes

### `has_discussions` now routes through GraphQL instead of being silently dropped

`GitHubRepository.applySettings` sent `has_discussions` to the REST patch, which ignores unknown fields and answers 200 — so the setting was reported as applied on every run while the repository never changed. It now routes through the GraphQL arm as `hasDiscussionsEnabled` (verified against `UpdateRepositoryInput` by live introspection), alongside `has_sponsorships` and `has_pull_requests`.

Also documented: `GitHubIssue.isCrossReferencedBy`'s two guard hazards (issues obtained from `linkedIssues` answer `true` from the outset; sidebar-connected issues without a cross-reference read `false`), and `PullRequestInfo.body`'s wire behavior — present via `get` and `list`, absent (never `""`) when GitHub sends `null` — is now pinned by tests.
