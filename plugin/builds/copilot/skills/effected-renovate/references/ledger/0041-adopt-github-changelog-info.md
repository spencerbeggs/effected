---
id: "0041"
title: "ChangelogInfo in @effected/github replaces @changesets/get-github-info, with the token and server from GitHubClient"
kind: adopt
shows: none
applies:
  "@effected/github": ">=0.31.0"
detect: ["@changesets/get-github-info", "getInfoFromPullRequest", "getCommitInfo", "getPullRequestInfo"]
changesets: ["github-changelog-info"]
---

Offer this to the user; never apply it unasked. It fits a changelog formatter that calls `@changesets/get-github-info` for the author, pull request and links of a changeset's commit, and so reads `GITHUB_TOKEN`, `GITHUB_SERVER_URL` and `.env` from the process.

- `ChangelogInfo` is a service built with `ChangelogInfo.layer` over the `GitHubClient` you already provide. The token and the host come from that client; GitHub Enterprise Server works through the client's `baseUrl`. The repository comes from `Repo` in `R`, not from an `owner/repo` argument.
- `commit(sha)` answers the `getInfo` shape: `user`, `pull` and `links.{commit, pull, user}`. `pullRequest(number)` answers the `getInfoFromPullRequest` shape for a `pr: #N` override: `user`, `commit` and `links.{commit, pull, user}`. Every value that can be missing is an `Option`, not `null`, and so is the whole answer: a commit or pull request the repository lacks is `Option.none()`.
- The link strings are upstream's exactly, built from the URLs GitHub answers with.
- Concurrent lookups batch into one aliased GraphQL query of up to 50. Run them with `Effect.forEach(..., { concurrency: "unbounded" })`; sequential calls each cost a round trip, and nothing is cached across batches.
- A sha must be 4 to 64 hex characters and a pull number a positive integer, or the lookup fails `InvalidChangelogRefError` before sending. A missing repository fails `GitHubGraphQLError` with `kind: "notFound"`.

Check the installed `.d.ts` for the exact shapes. Verify by running the changelog against a known commit and comparing the produced line with the one the old package produced.
