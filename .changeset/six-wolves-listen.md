---
"@effected/github": minor
---

## Breaking Changes

### `PullRequest.listFiles` returns full file records

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

## Bug Fixes

`GitHubRelease.uploadAsset` now carries the asset `name` in the route
template. The release-asset route is the one route outside GitHub's generated
endpoint map, so no schema told octokit that `name` is a query parameter —
passed only as a parameter it was silently dropped, GitHub answered `400
Invalid name for request`, and every release asset upload failed quietly.
The member also gains the endpoint's optional `label` (the display label
shown in place of the file name on the release page).

## Features

`BotIdentity` gains a `signoff` getter rendering the DCO 1.1 sign-off
trailer — `Signed-off-by: <name> <email>` — from the type that owns the
data. Commits created through the Git Data API bypass `git commit -s`, so
the trailer has no porcelain to come from, and a hand-built one that is
subtly wrong surfaces late as a red DCO check on someone else's pull
request. Whether a missing identity falls back to
`BotIdentity.githubActions` stays the caller's policy.

## Documentation

`GitBranch.upsert`'s remarks now warn about a live incident: resetting a
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
run that otherwise reports success.
