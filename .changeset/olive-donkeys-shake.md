---
"@effected/github": patch
---

## Documentation

- `PullRequest.list` now documents that its `head` option accepts either a qualified `owner:ref` or a bare `ref`, which is qualified with the current repo's owner automatically. Feeding `PullRequestInfo.head` — which is the bare ref — straight back into the filter is correct; only the raw REST route would silently return nothing. Consumers filtering the full list client-side to work around that no longer need to.
- `GitTag.latestSemver` now states that "newest" means highest version, not most recent, and that it is the wrong instrument for a monorepo publishing independently versioned packages. Version ordering and recency are unrelated there, so the result can sit several releases behind the head and never move, with nothing visible to signal it. Filter by the package's tag prefix instead.
- `PullRequestInfo` and the private `RawPull` wire interface now cross-reference each other, naming which is the domain shape and which is what GitHub answers with. The two differ in exactly the places that matter (`head`/`headSha` versus a nested `head: { ref, sha }`, `url` versus `html_url`).
