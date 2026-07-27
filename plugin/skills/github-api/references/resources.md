# Resource service catalogue

> Load when: you need a specific `@effected/github` resource service's member
> list, signature, or return type. Routing, error, pagination and layer
> patterns live in the main `SKILL.md` — this file is the per-resource
> lookup only.

Every service below: `Context.Service<Self, Shape>()("@effected/github/<Name>")`,
`static readonly layer: Layer.Layer<Self, never, GitHubClient>` built as
`Layer.effect(this, Effect.map(GitHubClient, (client) => make(client)))`, plus
`makeTest(overrides?: Partial<Shape>)` and `layerTest(overrides?)` where every
unstubbed member dies naming itself. `E` is `GitHubError` unless noted. Every
method requires `Repo` in its `R` unless noted (`ArtifactMetadata` is
org-scoped and does not). Signatures are abridged to shape; citations are
`file:line` in `packages/github/src/`.

## `GitBranch` — `GitBranch.ts`

Branch refs in GitHub's **Git Database API** — not local git; no subprocess,
no working tree (`@effected/git` runs git).

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(name, sha) => Effect<void>` | Fails `alreadyExists` if already there (`:165-175`) |
| `upsert` | `(name, sha) => Effect<BranchOutcome>` | `"created" \| "reset"`; one call, no TOCTOU. **A reset is observable**: `upsert(branch, targetHead)` intending to add a commit later leaves the branch equal to the target, and GitHub **auto-closes an open PR whose diff is empty** — build the commit first and upsert once, straight to the finished sha (`:59-71,202-235`) |
| `exists` | `(name) => Effect<boolean>` | 404 degrades to `false` (`:225-228`) |
| `sha` | `(name) => Effect<string>` | Fails `notFound` if absent (`:229-233`) |
| `shaOption` | `(name) => Effect<Option<string>>` | Absence as `Option.none` (`:213-219`) |
| `reset` | `(name, sha) => Effect<void>` | Force-moves; fails `notFound` (`:177-188`) |
| `delete` | `(name) => Effect<void>` | `:250-259` |
| `createLinked` | `({issueNodeId, repositoryNodeId, name, sha}) => Effect<void, GitHubGraphQLError>` | The **one** operation with no REST equivalent — GraphQL `createLinkedBranch` only (`:70-86,235-249`) |

`main`/`refs/heads/main`/`heads/main` are all normalized to the short form
(`:139`). An empty branch name (after normalizing) fails typed rather than
reaching the API (`:141-146`).

## `GitTag` — `GitTag.ts`

Tag refs, same Git Database API family as `GitBranch`.

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(tag, sha) => Effect<void>` | `:150-160` |
| `upsert` | `(tag, sha) => Effect<void>` | Same `alreadyExists` recovery as `GitBranch.upsert` (`:199-203`) |
| `delete` | `(tag) => Effect<void>` | `:204-213` |
| `list` | `(options?: {prefix?, page?}) => Effect<ReadonlyArray<TagRef>>` | `TagRef = {tag, sha}`. `prefix` filters **client-side** — GitHub has no server-side ref-prefix filter here (`:181-195`) |
| `resolve` | `(tag) => Effect<string>` | Dereferences annotated tags; fails past `MAX_TAG_PEEL = 5` levels (`:215-246`) |
| `latestSemver` | `(options?: LatestSemverOptions) => Effect<Option<SemverTag>>` | `SemverTag = {tag, sha, version: SemVer}`. One pass over the page stream, both parse and compare synchronous via `@effected/semver` — no per-candidate `Effect` round trip (`:247-269`) |

`LatestSemverOptions`: `prefix?`, `includePrerelease?` (default excludes
prereleases), `extract?: VersionFromTag` (override the tag→version
convention), `page?: PageOptions`. The default `versionFromTag` strips a
leading `v` and takes the substring after the **last** `@`, covering
`v1.2.3`, `pkg@v1.2.3` and `@scope/pkg@1.2.3` (`:51-56`).

## `GitCommit` — `GitCommit.ts`

Commits, trees and blobs in the **Git Database API**.

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(sha) => Effect<CommitRef>` | `CommitRef = {sha, treeSha, parents}` — exists specifically so no caller casts for `tree.sha` as a `base_tree` (`:138-151`) |
| `createTree` | `({changes, baseTree?}) => Effect<string>` (tree sha) | `changes: ReadonlyArray<FileChange>` — `FileContent \| FileDeletion` tagged union (`:153-166`) |
| `createCommit` | `({message, tree, parents}) => Effect<string>` (commit sha) | `:168-183` |
| `commitFiles` | `({branch, message, changes}) => Effect<string>` (commit sha) | Read branch → build tree on its commit's tree → create commit → move ref, as one operation; the ref move is **not forced** — a branch that moved underneath you is a real conflict. **"Commit onto a branch you own", not a rebase**: never spell a rebase as `GitBranch.upsert(branch, targetHead)` then `commitFiles` — between the calls the branch *is* the target head and GitHub auto-closes an open PR with an empty diff; compose `get` → `createTree` → `createCommit` (target as parent) → one `upsert` to the finished sha (`:88-113,202-213`) |

## `GitHubCommit` — `GitHubCommit.ts`

Reading commits as GitHub reports them (not the Git Database API — see
`SKILL.md`'s confusable-pair section).

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(ref) => Effect<CommitSummary>` | `{sha, message, author, authorLogin?, url, parents}`; `.subject` getter is the message's first line; `parents` is the parent shas in GitHub's order — empty for a root commit, two or more for a merge (`:207-212`) |
| `list` | `(options?: {ref?, path?, page?}) => Effect<ReadonlyArray<CommitSummary>>` | `:214-232` |
| `compare` | `(base, head) => Effect<CommitComparison>` | `{status, aheadBy, behindBy, commits, files}`; paginates **by commit** (`:234-249`) |
| `changedFiles` | `(ref, options?: {page?}) => Effect<ReadonlyArray<CommitFile>>` | Paginates **by file**, 300/page — GitHub's own constraint, so a one-commit `compare` is permanently truncated at 300 files no matter what you pass (`:251-284`) |

`CommitFile = {path, status, additions, deletions, previousPath?}`; `status`
is one of `added/removed/modified/renamed/copied/changed/unchanged`.

## `GitHubRepository` — `GitHubRepository.ts`

| Member | Signature | Notes |
| --- | --- | --- |
| `settings` | `Effect<RepositorySettings>` | The **faithful generated** payload (`Rest.Data<"GET /repos/{owner}/{repo}">`), not a hand-picked projection — deliberately, so a caller needing sixteen fields never re-declares them (`:19,87-91`) |
| `updateSettings` | `(patch: RepositoryPatch) => Effect<RepositorySettings>` | `RepositoryPatch = Omit<Rest.Params<"PATCH /repos/{owner}/{repo}">, "owner"\|"repo">` (`:26,95-99`) |
| `defaultBranch` | `Effect<string>` | Derived from `settings` (`:100`) |
| `nodeId` | `Effect<string>` | The repo's GraphQL node id, needed by `createLinkedBranch`/`createPullRequest`-family mutations (`:101`) |

`settings`, `defaultBranch` and `nodeId` are **properties**, not functions —
each is `Effect.Effect<_, GitHubError, Repo>` directly.

## `GitHubContent` — `GitHubContent.ts`

| Member | Signature | Notes |
| --- | --- | --- |
| `getFile` | `(path, options?: {ref?}) => Effect<string>` | Rejects a directory listing, a non-`file` type, and any encoding other than `base64` (an over-size file comes back `encoding: "none"` and would decode to silent garbage) (`:56-91`) |
| `getFileOption` | `(path, options?) => Effect<Option<string>>` | Absence (404) as `Option.none` — "the file isn't there" is not an error for a config read (`:95-103`) |

## `GitHubIssue` — `GitHubIssue.ts`

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(number) => Effect<IssueInfo>` | `:199-208` |
| `list` | `(options?: {state?, labels?, page?}) => Effect<ReadonlyArray<IssueInfo>>` | `:210-228` |
| `close` | `(number, reason?: "completed"\|"not_planned") => Effect<void>` | `:230-240` |
| `comment` | `(number, body) => Effect<number>` (comment id) | `:242-252` |
| `linkedIssues` | `(prNumber) => Effect<ReadonlyArray<LinkedIssue>, GitHubGraphQLError>` | Owned GraphQL document; `LinkedIssue.userLinked` tells you whether a human linked it vs GitHub inferring it (`:66-77,254-269`) |
| `isCrossReferencedBy` | `(issueNumber, prNumber) => Effect<boolean, GitHubGraphQLError>` | Idempotence guard over the issue timeline, so a re-run doesn't comment twice (`:98-114,271-278`) |

`IssueInfo = {number, title, state, labels, url, nodeId}` — `labels`
normalizes GitHub's `string | {name}` union to plain names.

## `GitHubRelease` — `GitHubRelease.ts`

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(input) => Effect<ReleaseInfo>` | `:170-191` |
| `getByTag` | `(tag) => Effect<ReleaseInfo>` | `:160-165` |
| `getByTagOption` | `(tag) => Effect<Option<ReleaseInfo>>` | `:193-198` |
| `list` | `(options?: {page?}) => Effect<ReadonlyArray<ReleaseInfo>>` | `:200-205` |
| `update` | `(id, patch) => Effect<ReleaseInfo>` | `:207-228` |
| `uploadAsset` | `(release: ReleaseInfo, asset: {name, data, contentType, label?}) => Effect<ReleaseAsset>` | Uses `requestDecoded` — this route is not in the generated map, so the template carries the query itself: `assets{?name}` (`{?name,label}` when `label` is set) or octokit silently drops `name` and GitHub answers 400. `label` is the release page's display label (`:68-92,238-271`) |
| `listAssets` | `(id, options?: {page?}) => Effect<ReadonlyArray<ReleaseAsset>>` | Now forwards `PageOptions`; the predecessor hardcoded `{}` here (`:252-266`) |

`ReleaseInfo = {id, tag, name, body, draft, prerelease, url, uploadUrl}`;
GitHub's `null` name/body become `""` (`:141`). `ReleaseAsset = {id, name,
url, size}`.

## `PullRequest` — `PullRequest.ts`

| Member | Signature | Notes |
| --- | --- | --- |
| `get` | `(number) => Effect<PullRequestInfo>` | `:332-341` |
| `list` | `(options?: {head?, base?, state?, page?}) => Effect<ReadonlyArray<PullRequestInfo>>` | `:259-278` |
| `listFiles` | `(number, options?: {page?}) => Effect<ReadonlyArray<CommitFile>>` | Full `CommitFile`s — path **and** status, line counts, pre-rename path — the same `diff-entry` projection `GitHubCommit.changedFiles` returns. An earlier version projected to the path alone and consumers needing the status fell back to a raw route (`:343-357`) |
| `listAssociatedWithCommit` | `(sha, options?: {page?}) => Effect<ReadonlyArray<PullRequestInfo>>` | Named for the question it answers; the predecessor had this method and one consumer never found it, dropping to the survey's only `noExplicitAny` instead. Now paginates, which it did not (`:359-371`) |
| `create` | `(input) => Effect<PullRequestInfo>` | `:280-299` |
| `update` | `(number, patch) => Effect<PullRequestInfo>` | Conditional spreads, not `...patch` — `exactOptionalPropertyTypes` makes a present-but-`undefined` key different from an absent one (`:301-325`) |
| `upsert` | `(input) => Effect<UpsertedPullRequest>` | `{pullRequest, created}`; finds the open PR for `head`→`base` via a one-page lookup, else creates (`:373-395`) |
| `merge` | `(number, options?: {method?, commitTitle?, commitMessage?}) => Effect<string>` (merge sha) | `:397-416` |
| `addLabels` | `(number, labels) => Effect<void>` | `:418-427` |
| `requestReviewers` | `(number, {users?, teams?}) => Effect<void>` | `:429-445` |
| `setAutoMerge` | `(pullRequest, method: "merge"\|"squash"\|"rebase"\|"off") => Effect<void, GitHubGraphQLError>` | Explicit call, not an option on `create`/`update` — the predecessor fired this from an `Effect.tap` *after* create succeeded, so a working create could still surface an auto-merge failure as if it hadn't (`:447-460`) |

`PullRequestInfo`: `number`, `nodeId`, `url`, `title`, `state`, `head`,
`headSha`, `base`, `baseSha` (branch names **and** the shas they pointed at —
`baseSha` answers "which commit did this PR branch from"), `draft`, `merged`,
`mergedAt: Option<DateTime.Utc>` (an `Option`, not an optional field —
whether a PR has merged is a fact GitHub always reports), `body?`,
`mergeCommitSha?` (`:19-51`).

## `PullRequestComment` — `PullRequestComment.ts`

Sticky comments on a pull request or issue, marked with `CommentMarker` (a
pure class — see `SKILL.md`).

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(issueNumber, body) => Effect<CommentRecord>` | `:117-127` |
| `upsert` | `(issueNumber, marker, body) => Effect<CommentRecord>` | Appends the marker's `.html` to `body`; updates if found, else creates (`:149-167`) |
| `find` | `(issueNumber, marker, options?: {page?}) => Effect<Option<CommentRecord>>` | **Paginates** — the predecessor read one page of 100 and stopped, so the marker silently vanished on busy PRs (`:75-79,129-143`) |
| `delete` | `(commentId) => Effect<void>` | `:169-177` |

`CommentRecord = {id, body, url}`.

## `CheckRun` — `CheckRun.ts`

Uses `CheckRunOutput` (pure class — see `SKILL.md`) for the rendered body.

| Member | Signature | Notes |
| --- | --- | --- |
| `create` | `(name, headSha) => Effect<CheckRunRef>` | Starts `in_progress` (`:200-212`) |
| `get` | `(id) => Effect<CheckRunRef>` | `:236-245` |
| `update` | `(id, output: CheckRunOutput) => Effect<void>` | Output is truncated to GitHub's byte budget before the request goes out (`:175-194,247-256`) |
| `complete` | `(id, conclusion, output?) => Effect<void>` | `:214-230` |
| `withCheckRun` | `<A,E,R>(name, headSha, use: (id) => Effect<A,E,R>) => Effect<A, E\|GitHubError, R\|Repo>` | Bracket: completes `success` on the use effect's success, `failure` on its error (best-effort, `Effect.ignore`d). `use` keeps its own `R` — the predecessor's callback was `R`-less, forcing consumers to build self-contained layers (`:139-143,258-269`) |

`CheckRunRef = {id, name, url, status}`.

## `WorkflowDispatch` — `WorkflowDispatch.ts`

| Member | Signature | Notes |
| --- | --- | --- |
| `dispatch` | `(workflow, ref, inputs?) => Effect<void>` | GitHub answers 204, no run id (`:113-127`) |
| `runStatus` | `(runId) => Effect<WorkflowRunStatus>` | `:129-138` |
| `dispatchAndWait` | `(workflow, ref, options?: {inputs?, poll?: PollOptions}) => Effect<WorkflowRunStatus>` | Dispatches, then finds the run by creation time and polls. `PollOptions = {interval? = 10s, timeout? = 5m}`. The wait is `Effect.repeat` with a `while` predicate over the **success** value — the predecessor encoded "not done yet" as a sentinel *error*, control flow baked into a user-visible error union. A genuine timeout fails `kind: "rejected"`, status `408` (`:144-189`) |

`WorkflowRunStatus = {id, status, conclusion?, url}`, with `.isDone` true
once `status === "completed"`.

## `Attestation` — `Attestation.ts`

REST upload/list only — signing and SBOM assembly belong to
`@effected/sbom` and the consumer's pipeline respectively (see
`supply-chain-attestation`, out of scope for this skill).

| Member | Signature | Notes |
| --- | --- | --- |
| `upload` | `(bundle: unknown) => Effect<AttestationRecord>` | Pins `X-GitHub-Api-Version: 2026-03-10`; uses `requestDecoded` (`:110-122`) |
| `listForSubject` | `(sha256, options?: {predicateType?}) => Effect<ReadonlyArray<AttestationListEntry>>` | **404 and 422 both mean "none"**, degraded to an empty list rather than an error (`:73-80,124-161`) |

`sha256` is normalized to `sha256:<hex>` if the caller didn't prefix it
(`:129`).

## `ArtifactMetadata` — `ArtifactMetadata.ts`

The **endpoint** is org-scoped, but the organization is resolved from
`Repo`'s `owner` per call like every other resource — `Repo.provide` covers
the cross-org case. (An earlier version took `org` positionally, the one
method on the surface that did.)

| Member | Signature | Notes |
| --- | --- | --- |
| `createStorageRecord` | `(input: StorageRecordInput) => Effect<ReadonlyArray<number>, GitHubError, Repo>` | Returns the stored ids. `StorageRecordInput` has **no `version` field** — the predecessor sent one the endpoint has no notion of, silently accepted by a `Record<string, unknown>` body and rejected outright by the generated types (`:16-29,76-96`) |

## `TokenPermissions` — `TokenPermissions.ts` (pure class, no layer)

| Member | Signature | Notes |
| --- | --- | --- |
| `TokenPermissions.fromGitHub` | `(permissions: Record<string,string>) => TokenPermissions` | Static constructor; ignores any level it doesn't recognize (`:118-131`) |
| `compare` | `(required) => PermissionResult` | Pure and total. `PermissionResult = {missing, extra}` with `.satisfied`/`.exact` getters (`:47-62,134-154`) |
| `assertSufficient` | `(required) => Effect<void, TokenPermissionError>` | Fails `kind: "insufficient"` (`:156-160`) |
| `assertExact` | `(required) => Effect<void, TokenPermissionError>` | Also fails `kind: "excess"` if the token holds more than asked (`:162-173`) |

`read < write < admin`. Not a service — see `SKILL.md`'s pure-classes
section for why.
