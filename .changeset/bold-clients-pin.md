---
"@effected/github": minor
---

## Breaking Changes

### REST API version pinned on every request

`GitHubClientOptions` and `GitHubAppOptions` take a new `apiVersion` option. Every request now sends `X-GitHub-Api-Version`, defaulting to `2026-03-10`, and the value in effect is readable as `client.apiVersion`. A per-call override still wins. The option must be a `YYYY-MM-DD` calendar version. Closes #364.

**Migration:** GitHub Enterprise Server releases that predate `2026-03-10` reject that version. Set `apiVersion` to one your server supports. Behaviour that depends on the version follows the pin:

- `dispatchWithRun` sends `return_run_details` only when `apiVersion` predates `2026-03-10`. Later versions return run details without it.
- Uninstalling an app answers `202` under the new version.

### `mergeCommitSha` comes from GraphQL

The REST pull request object no longer carries a merge commit, so `PullRequestInfo.mergeCommitSha` is now read from GraphQL `mergeCommit.oid`. It is present only once the pull request is merged. `get`, `update` and `upsert` always fill it. `list` and `listAssociatedWithCommit` fill it only when you pass `mergeCommits: true`, at one GraphQL call per 100 merged pull requests. All five methods can now fail with `GitHubGraphQLError`. Closes #364.

**Migration:** pass `mergeCommits: true` to `list` or `listAssociatedWithCommit` where you read `mergeCommitSha`, and handle `GitHubGraphQLError` on those calls.

### `applySettings` drops keys REST does not accept

`AppliedSettings` gains a required `ignored` array next to `rest` and `graphql`. It names the keys neither API accepts, a typo for example. Those keys are no longer sent: the REST `PATCH` would ignore them and still answer `200`. The accepted REST keys come from GitHub's OpenAPI description, and a key a later API version removed is ignored only for a client pinned at or past that version. Closes #376.

**Migration:** code that builds or matches `AppliedSettings` values must account for `ignored`.

## Features

### Repository topics

`GitHubRepository.topics` reads a repository's topics. `setTopics(names)` replaces the whole set and returns the names GitHub stored, which GitHub lowercases. Closes #359.
