---
"@effected/github": patch
---

## Documentation

- `PullRequest.list` now documents that its `head` option accepts either a qualified `owner:ref` or a bare `ref`, which is qualified with the current repo's owner automatically. For a pull request opened from the current repository, feeding `PullRequestInfo.head` — the bare ref — straight back into the filter round-trips correctly, so consumers filtering client-side to work around the raw REST route no longer need to. The docs also state the limit: `PullRequestInfo` drops the source owner, so the round trip does not hold for a fork-originated pull request, where qualifying with the current owner names a branch in the wrong account and matches nothing.
- `GitTag.latestSemver` now states that "newest" means highest version, not most recent, and that it is the wrong instrument for a monorepo publishing independently versioned packages. Version ordering and recency are unrelated there, so the result can sit several releases behind the head and never move, with nothing visible to signal it. Filter by the package's tag prefix instead.
- `PullRequestInfo` and the private `RawPull` wire interface now cross-reference each other, naming which is the domain shape and which is what GitHub answers with. The two differ in exactly the places that matter (`head`/`headSha` versus a nested `head: { ref, sha }`, `url` versus `html_url`).
