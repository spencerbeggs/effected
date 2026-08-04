# Resource service catalogue

Load when: you need a specific `@effected/github` resource service's member
list, signature, or return type. Routing, error, pagination and layer
patterns live in `SKILL.md` — this file is the per-resource lookup only.

Every service below follows one shape: `Context.Service<Self, Shape>()("@effected/github/<Name>")`,
a `static readonly layer: Layer.Layer<Self, never, GitHubClient>` built as
`Layer.effect(this, Effect.map(GitHubClient, (client) => make(client)))`, plus
`makeTest(overrides?: Partial<Shape>)` and `layerTest(overrides?)` where every
unstubbed member dies naming itself. `E` is `GitHubError` unless noted. Every
method requires `Repo` in its `R` unless noted (`ArtifactMetadata` is
org-scoped and does not). Signatures below are abridged to shape — grep the
installed package for exact parameter names.

## `GitBranch`

Branch refs in GitHub's Git Database API — not local git; no subprocess, no
working tree (`@effected/git` is the package that runs git).

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(name, sha) => Effect<void>` | Fails `alreadyExists` if already there |
| `upsert` | `(name, sha) => Effect<BranchOutcome>` | `"created" \| "reset"`; one call, no TOCTOU. A reset is observable: `upsert(branch, targetHead)` intending to add a commit later leaves the branch equal to the target, and GitHub auto-closes an open PR whose diff is empty — build the commit first and upsert once, straight to the finished sha |
| `exists` | `(name) => Effect<boolean>` | 404 degrades to `false` |
| `sha` | `(name) => Effect<string>` | Fails `notFound` if absent |
| `shaOption` | `(name) => Effect<Option<string>>` | Absence as `Option.none` |
| `reset` | `(name, sha) => Effect<void>` | Force-moves; fails `notFound` |
| `delete` | `(name) => Effect<void>` | |
| `createLinked` | `({issueNodeId, repositoryNodeId, name, sha}) => Effect<void, GitHubGraphQLError>` | The one operation with no REST equivalent — GraphQL `createLinkedBranch` only |

`main`/`refs/heads/main`/`heads/main` all normalize to the short form. An
empty branch name (after normalizing) fails typed rather than reaching the
API.

## `GitTag`

Tag refs, same Git Database API family as `GitBranch`.

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(tag, sha) => Effect<void>` | |
| `upsert` | `(tag, sha) => Effect<void>` | Same `alreadyExists` recovery as `GitBranch.upsert` |
| `delete` | `(tag) => Effect<void>` | |
| `list` | `(options?: {prefix?, page?}) => Effect<ReadonlyArray<TagRef>>` | `TagRef = {tag, sha}`. `prefix` filters client-side — GitHub has no server-side ref-prefix filter here |
| `resolve` | `(tag) => Effect<string>` | Dereferences annotated tags; fails past a peel depth of 5 |
| `latestSemver` | `(options?: LatestSemverOptions) => Effect<Option<SemverTag>>` | `SemverTag = {tag, sha, version}`. One pass over the page stream, both parse and compare synchronous via `@effected/semver` — no per-candidate `Effect` round trip. **Picks the highest parsed version, not the most recently created tag** — in a monorepo with independently-versioned packages the two can disagree; scope with `prefix` to the package you mean |

`LatestSemverOptions`: `prefix?`, `includePrerelease?` (default excludes
prereleases), `extract?: VersionFromTag` (override the tag→version
convention), `page?: PageOptions`. The default `versionFromTag` strips a
leading `v` and takes the substring after the last `@`, covering `v1.2.3`,
`pkg@v1.2.3` and `@scope/pkg@1.2.3`.

## `GitCommit`

Commits, trees and blobs in the Git Database API.

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(sha) => Effect<CommitRef>` | `CommitRef = {sha, treeSha, parents}` — built so no caller casts for `tree.sha` as a `base_tree` |
| `createTree` | `({changes, baseTree?}) => Effect<string>` (tree sha) | `changes: ReadonlyArray<FileChange>` — a `FileContent \| FileDeletion` tagged union |
| `createCommit` | `({message, tree, parents}) => Effect<string>` (commit sha) | |
| `commitFiles` | `({branch, message, changes}) => Effect<string>` (commit sha) | Read branch → build tree on its commit's tree → create commit → move ref, as one operation; the ref move is not forced — a branch that moved underneath you is a real conflict. **"Commit onto a branch you own", not a rebase**: never spell a rebase as `GitBranch.upsert(branch, targetHead)` then `commitFiles` — between the calls the branch *is* the target head and GitHub auto-closes an open PR with an empty diff; compose `get` → `createTree` → `createCommit` (target as parent) → one `upsert` to the finished sha |

## `GitHubCommit`

Reading commits as GitHub reports them — not the Git Database API. Pick by
what you're doing: writing a commit onto a tree is `GitCommit`; reading what
a commit says is `GitHubCommit`.

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(ref) => Effect<CommitSummary>` | `{sha, message, author, authorLogin?, url, parents}`; `.subject` getter is the message's first line; `parents` is empty for a root commit, two or more for a merge |
| `list` | `(options?: {ref?, path?, page?}) => Effect<ReadonlyArray<CommitSummary>>` | |
| `compare` | `(base, head) => Effect<CommitComparison>` | `{status, aheadBy, behindBy, commits, files}`; paginates by commit |
| `changedFiles` | `(ref, options?: {page?}) => Effect<ReadonlyArray<CommitFile>>` | Paginates by file, 300/page — GitHub's own constraint, so a one-commit `compare` is permanently truncated at 300 files no matter what you pass |

`CommitFile = {path, status, additions, deletions, previousPath?}`; `status`
is one of `added/removed/modified/renamed/copied/changed/unchanged`.

## `GitHubRepository`

| Member | Signature | Notes |
| --- | --- | --- |
| `settings` | `Effect<RepositorySettings>` | The faithful generated payload, not a hand-picked projection — deliberately, so a caller needing sixteen fields never re-declares them |
| `updateSettings` | `(patch) => Effect<RepositorySettings>` | |
| `defaultBranch` | `Effect<string>` | Derived from `settings` |
| `nodeId` | `Effect<string>` | The repo's GraphQL node id, needed by `createLinkedBranch`/`createPullRequest`-family mutations |

`settings`, `defaultBranch` and `nodeId` are properties, not functions.

## `GitHubContent`

| Member | Signature | Notes |
| --- | --- | --- |
| `getFile` | `(path, options?: {ref?}) => Effect<string>` | Rejects a directory listing, a non-`file` type, and any encoding other than `base64` — an over-size file comes back `encoding: "none"` and would decode to silent garbage |
| `getFileOption` | `(path, options?) => Effect<Option<string>>` | Absence (404) as `Option.none` — "the file isn't there" is not an error for a config read |

## `GitHubIssue`

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(number) => Effect<IssueInfo>` | |
| `list` | `(options?: {state?, labels?, page?}) => Effect<ReadonlyArray<IssueInfo>>` | |
| `close` | `(number, reason?: "completed"\|"not_planned") => Effect<void>` | |
| `comment` | `(number, body) => Effect<number>` (comment id) | |
| `linkedIssues` | `(prNumber) => Effect<ReadonlyArray<LinkedIssue>, GitHubGraphQLError>` | Owned GraphQL document; `LinkedIssue.userLinked` tells you whether a human linked it vs GitHub inferring it |
| `isCrossReferencedBy` | `(issueNumber, prNumber) => Effect<boolean, GitHubGraphQLError>` | Idempotence guard over the issue timeline so a re-run doesn't comment twice |

`IssueInfo = {number, title, state, labels, url, nodeId}` — `labels`
normalizes GitHub's `string | {name}` union to plain names.

## `GitHubRelease`

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(input) => Effect<ReleaseInfo>` | |
| `getByTag` | `(tag) => Effect<ReleaseInfo>` | |
| `getByTagOption` | `(tag) => Effect<Option<ReleaseInfo>>` | |
| `list` | `(options?: {page?}) => Effect<ReadonlyArray<ReleaseInfo>>` | |
| `update` | `(id, patch) => Effect<ReleaseInfo>` | |
| `uploadAsset` | `(release, asset: {name, data, contentType, label?}) => Effect<ReleaseAsset>` | Uses `requestDecoded` — release-asset upload isn't in the generated route map, so the template carries the query itself: `assets{?name}` (`{?name,label}` when `label` is set) — a `name` passed only as a parameter gets silently dropped by octokit and GitHub answers 400. `label` is the release page's display label |
| `listAssets` | `(id, options?: {page?}) => Effect<ReadonlyArray<ReleaseAsset>>` | Forwards `PageOptions` |

`ReleaseInfo = {id, tag, name, body, draft, prerelease, url, uploadUrl}`;
GitHub's `null` name/body become `""`. `ReleaseAsset = {id, name, url, size}`.

## `PullRequest`

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(number) => Effect<PullRequestInfo>` | |
| `list` | `(options?: {head?, base?, state?, page?}) => Effect<ReadonlyArray<PullRequestInfo>>` | `head` wants `owner:ref` for a cross-fork search; the accessor qualifies a bare ref with your own repo's owner, so pass a fully-qualified `fork-owner:branch` explicitly whenever the head lives in a fork |
| `listFiles` | `(number, options?: {page?}) => Effect<ReadonlyArray<CommitFile>>` | Full `CommitFile`s — path and status, line counts, pre-rename path; the same diff-entry projection `GitHubCommit.changedFiles` returns |
| `listAssociatedWithCommit` | `(sha, options?: {page?}) => Effect<ReadonlyArray<PullRequestInfo>>` | Paginates |
| `create` | `(input) => Effect<PullRequestInfo>` | |
| `update` | `(number, patch) => Effect<PullRequestInfo>` | Conditional spreads, not `...patch` — `exactOptionalPropertyTypes` makes a present-but-`undefined` key different from an absent one |
| `upsert` | `(input) => Effect<UpsertedPullRequest>` | `{pullRequest, created}`; finds the open PR for `head`→`base` via a one-page lookup, else creates |
| `merge` | `(number, options?: {method?, commitTitle?, commitMessage?}) => Effect<string>` (merge sha) | |
| `addLabels` | `(number, labels) => Effect<void>` | |
| `requestReviewers` | `(number, {users?, teams?}) => Effect<void>` | |
| `setAutoMerge` | `(pullRequest, method: "merge"\|"squash"\|"rebase"\|"off") => Effect<void, GitHubGraphQLError>` | An explicit call, never an option on `create`/`update` — firing it from a `tap` after create would let a working create surface an auto-merge failure as if the create itself had failed |

`PullRequestInfo`: `number`, `nodeId`, `url`, `title`, `state`, `head`,
`headSha`, `base`, `baseSha` (branch names and the shas they pointed at),
`draft`, `merged`, `mergedAt: Option<DateTime.Utc>` (an `Option`, not an
optional field — whether a PR has merged is a fact GitHub always reports),
`body?`, `mergeCommitSha?`.

## `PullRequestComment`

Sticky comments on a pull request or issue, marked with `CommentMarker` (a
pure class — see `SKILL.md`).

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(issueNumber, body) => Effect<CommentRecord>` | |
| `upsert` | `(issueNumber, marker, body) => Effect<CommentRecord>` | Appends the marker's `.html` to `body`; updates if found, else creates |
| `find` | `(issueNumber, marker, options?: {page?}) => Effect<Option<CommentRecord>>` | Paginates every page of issue comments — a single-page lookup lets a marker silently vanish past the first hundred comments on a busy PR |
| `delete` | `(commentId) => Effect<void>` | |

`CommentRecord = {id, body, url}`.

## `CheckRun`

Uses `CheckRunOutput` (pure class — see `SKILL.md`) for the rendered body.

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(name, headSha) => Effect<CheckRunRef>` | Starts `in_progress` |
| `get` | `(id) => Effect<CheckRunRef>` | |
| `update` | `(id, output: CheckRunOutput) => Effect<void>` | Output is truncated to GitHub's byte budget before the request goes out |
| `complete` | `(id, conclusion, output?) => Effect<void>` | |
| `withCheckRun` | `<A,E,R>(name, headSha, use: (id) => Effect<A,E,R>) => Effect<A, E\|GitHubError, R\|Repo>` | Bracket: completes `success` on the use effect's success, `failure` on its error (best-effort, ignored). `use` keeps its own `R` and its own `A` |

`CheckRunRef = {id, name, url, status}`. For the full bracket contract
(reachable conclusions, the exit-aware finalizer, output truncation
mechanics) see `actions-reporting`'s reference.

## `WorkflowDispatch`

| Member | Signature | Notes |
| --- | --- | --- |
| `dispatch` | `(workflow, ref, inputs?) => Effect<void>` | GitHub answers 204, no run id |
| `runStatus` | `(runId) => Effect<WorkflowRunStatus>` | |
| `dispatchAndWait` | `(workflow, ref, options?: {inputs?, poll?: PollOptions}) => Effect<WorkflowRunStatus>` | Dispatches, then finds the run by creation time and polls; `PollOptions = {interval? = 10s, timeout? = 5m}`. The wait is `Effect.repeat` with a `while` predicate over the success value, not a sentinel error for "not done yet" — a genuine timeout fails `kind: "rejected"`, status 408 |

`WorkflowRunStatus = {id, status, conclusion?, url}`, `.isDone` true once
`status === "completed"`.

## `Attestation`

REST upload/list only — signing and SBOM assembly belong to `@effected/sbom`
and the consumer's pipeline respectively (see `supply-chain-attestation`, out
of scope for this skill).

| Member | Signature | Notes |
| --- | --- | --- |
| `upload` | `(bundle: unknown) => Effect<AttestationRecord>` | Pins a fixed `X-GitHub-Api-Version`; uses `requestDecoded` |
| `listForSubject` | `(sha256, options?: {predicateType?}) => Effect<ReadonlyArray<AttestationListEntry>>` | 404 and 422 both mean "none", degraded to an empty list rather than an error |

`sha256` is normalized to `sha256:<hex>` if the caller didn't prefix it.

## `ArtifactMetadata`

The endpoint is org-scoped, but the organization is resolved from `Repo`'s
`owner` per call like every other resource — `Repo.provide` covers the
cross-org case.

| Member | Signature | Notes |
| --- | --- | --- |
| `createStorageRecord` | `(input: StorageRecordInput) => Effect<ReadonlyArray<number>, GitHubError, Repo>` | Returns the stored ids. `StorageRecordInput` has no `version` field — the endpoint has no notion of one; sending one is silently accepted by an untyped body and rejected outright by the generated types |

## `TokenPermissions` (pure class, no layer)

| Member | Signature | Notes |
| --- | --- | --- |
| `TokenPermissions.fromGitHub` | `(permissions: Record<string,string>) => TokenPermissions` | Static constructor; ignores any level it doesn't recognize |
| `compare` | `(required) => PermissionResult` | Pure and total. `PermissionResult = {missing, extra}` with `.satisfied`/`.exact` getters |
| `assertSufficient` | `(required) => Effect<void, TokenPermissionError>` | Fails `kind: "insufficient"` |
| `assertExact` | `(required) => Effect<void, TokenPermissionError>` | Also fails `kind: "excess"` if the token holds more than asked |

`read < write < admin`. Not a service — see `SKILL.md`'s pure-classes
section for why.
