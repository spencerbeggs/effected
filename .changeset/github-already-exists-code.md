---
"@effected/github": patch
---

## Bug Fixes

- `GitHubError` now classifies a 422 or 409 as `alreadyExists` when GitHub reports a validation entry with the documented `code: "already_exists"`, even when no message says so. Creating a release for a tag that already has one sends exactly that shape, and it was classified as `rejected`, so a `catchIf(GitHubError.hasKind("alreadyExists"), ...)` fallback never ran.
