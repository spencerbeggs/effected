---
"@effected/git": minor
---

## Features

* `Git.treeIdentity(cwd)` returns the physical toplevel and common dir in one call, and `TreeIdentity.relation(a, b)` answers `same-tree`, `sibling-worktree` or `different-repo`.
* `Git.upstream(cwd)` returns an `UpstreamBranch` with `ref`, `name`, `gone`, `ahead` and `behind`. A deleted upstream reports `gone: true` instead of failing as an unknown ref.
* `GitRemote` parses a remote into `GitRemoteUrl`, `GitRemoteScp`, `GitRemotePath` or `GitRemoteTransport` following git's own classification, with `format`, `redact` and `repositoryPath`. A URL password is never retained.

## Breaking Changes

* Redaction of command arguments now goes through the same parser. A URL such as `https://host:8080/a@b` is over-redacted to `https://<redacted>@b`, and query strings in URL arguments are masked. If you derive a persisted key from a redacted remote, compare it against stored keys before upgrading.
