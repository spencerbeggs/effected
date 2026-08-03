# @effected/github

## 0.2.2

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.0 | 0.3.1 |

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.1

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

## 0.2.0

### Breaking Changes

* ### `PullRequest.listFiles` returns full file records

  `listFiles` used to project each changed file down to its path. It now
  returns the same `CommitFile` shape `GitHubCommit.changedFiles` does — path,
  status, line counts and any pre-rename path — because GitHub answers both
  endpoints with the same `diff-entry` payload.

  ```ts
  // Before
  const paths: ReadonlyArray<string> = yield* pullRequest.listFiles(42);

  // After
  const files: ReadonlyArray<CommitFile> = yield* pullRequest.listFiles(42);
  const paths = files.map((file) => file.path);
  ```

  ### `PullRequestInfo` carries the branch shas

  `PullRequestInfo` gains two required fields: `headSha` and `baseSha` — the
  commits `head` and `base` pointed at when GitHub answered. `baseSha` answers
  "which commit did this pull request branch from" without a second call.
  Any code constructing a `PullRequestInfo` by hand must supply both.

  ### `CommitSummary` carries `parents`

  `CommitSummary` gains a required `parents: ReadonlyArray<string>` field — the
  parent commit shas in GitHub's order, empty for a root commit and two or more
  for a merge commit. Any code constructing a `CommitSummary` by hand must
  supply it.

  ### `ArtifactMetadata.createStorageRecord` no longer takes a positional `org`

  The organization is now resolved from `Repo`'s `owner`, the same way every
  other resource on this surface reads it — `createStorageRecord` was the one
  method that took `org` positionally instead. `Repo` is required in `R`;
  `Repo.provide` covers the cross-org case.

  ```ts
  // Before
  yield* artifactMetadata.createStorageRecord(org, input);

  // After
  yield* artifactMetadata.createStorageRecord(input); // Repo required in R
  ```

### Features

* `BotIdentity` gains a `signoff` getter rendering the DCO 1.1 sign-off
  trailer — `Signed-off-by: <name> <email>` — from the type that owns the
  data. Commits created through the Git Data API bypass `git commit -s`, so
  the trailer has no porcelain to come from, and a hand-built one that is
  subtly wrong surfaces late as a red DCO check on someone else's pull
  request. Whether a missing identity falls back to
  `BotIdentity.githubActions` stays the caller's policy.

### Bug Fixes

* `GitHubRelease.uploadAsset` now carries the asset `name` in the route
  template. The release-asset route is the one route outside GitHub's generated
  endpoint map, so no schema told octokit that `name` is a query parameter —
  passed only as a parameter it was silently dropped, GitHub answered `400
  Invalid name for request`, and every release asset upload failed quietly.
  The member also gains the endpoint's optional `label` (the display label
  shown in place of the file name on the release page).

### Documentation

* `GitBranch.upsert`'s remarks now warn about a live incident: resetting a
  branch to its pull request's base makes that PR's head equal its base for a
  window, and GitHub **auto-closes a PR whose diff is empty**. A consumer that
  means to end at "target head plus a commit" should build the commit first —
  `GitCommit.get` the target for its tree sha, `createTree`, `createCommit`
  with the target as parent — and `upsert` once, straight to the finished sha.

  `GitCommit.commitFiles`'s remarks now state plainly that it commits onto a
  branch you own, not a rebase, and spell out the atomic composition — `get`,
  `createTree`, `createCommit`, `upsert` — that moves the ref once with no
  observable intermediate state. Sequencing `upsert(branch, targetHead)`
  followed by `commitFiles` is the hazardous two-step above written a
  different way: an open pull request from that branch sees an empty diff in
  the window between the two calls and GitHub can close it out from under a
  run that otherwise reports success. [#191][#191]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.1.0

### Features

* First release. Typed GitHub REST and GraphQL over octokit's core request
  surface, with GitHub App authentication and a set of resource services.

  ### The route is the key — no casts

  ```ts
  import { GitHubClient } from "@effected/github";
  import { Effect } from "effect";

  const defaultBranch = Effect.gen(function* () {
    const client = yield* GitHubClient;
    const repo = yield* client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" });
    return repo.default_branch; // string — no cast, no hand-written interface
  });
  ```

  `client.request(route, params)` types both the parameters and the returned
  data from the route literal alone; a route outside the generated map goes
  through `requestDecoded(route, params, schema)`, where the schema is
  mandatory. One paginating engine backs every paginated read.

  ### Resource services

  `GitBranch.upsert`, `GitTag.latestSemver` / `.upsert`, `CheckRun.withCheckRun`
  (with `conclude`), `PullRequest` / `PullRequestComment` upserts,
  `GitHubRelease`, `ArtifactMetadata`, `Attestation`, `GitHubCommit`,
  `GitHubContent`, `GitHubIssue`, `GitHubRepository` and `WorkflowDispatch`
  round out the typed surface over the raw request primitive.

  ### Errors and auth

  One `GitHubError` covers every REST resource, with a `kind` for routing and
  `hasKind` for narrowing; `kind: "alreadyExists"` is what makes an upsert
  implementable without a second existence check. `GitHubGraphQLError` covers
  GraphQL, and `GitHubApp` mints installation tokens (`GitHubAppError` on
  failure) without pulling in `@octokit/auth-app`'s OAuth machinery. [#180][#180]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180
