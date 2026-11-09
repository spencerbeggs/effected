---
"@effected/github": minor
---

## Features

* `ChangelogInfo` looks up what a changelog line credits, replacing `@changesets/get-github-info`. `commit(sha)` returns the author login, the pull request number and markdown links for the commit, pull request and user; `pullRequest(number)` returns the same for a changeset that names its pull request. Each answer is an `Option`, as is every value inside it that can be missing.
* The token and the server come from the `GitHubClient` the layer is built over, and the repository from `Repo`. Nothing is read from `process.env` or `.env`, and GitHub Enterprise Server works through the client's `baseUrl`.
* The query and the link strings match upstream's. Lookups that run concurrently are sent as one aliased GraphQL query of up to 50.
* A pull request number the repository lacks returns `Option.none()`, and so does a sha that names a tree or blob. Upstream fails the whole batch on the first and builds a link to `undefined` on the second. A sha that is not 4 to 64 hex characters, or a pull number that is not a positive integer, fails `InvalidChangelogRefError` before anything is sent.
* `GraphQLErrorEntry` now carries the `path` GitHub reports for an error, which names the aliased field that failed.
