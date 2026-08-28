# @effected/github

Typed GitHub REST and GraphQL over octokit's core request surface: one client
service, one error taxonomy, one retry policy, one pagination engine, and
twenty-odd resource services on top — branches, tags, commits, contents,
issues, pull requests, comments, checks, releases, workflow dispatch,
attestations, and the configuration-write six (secrets, variables, rulesets,
deployment environments, security toggles, code scanning). It also owns GitHub
App authentication and the libsodium sealed-box crypto pair GitHub's secrets
API demands. **Integrated tier** — it holds `@octokit/core`,
`@octokit/plugin-paginate-rest`, `universal-github-app-jwt`, `tweetnacl` and
`blakejs` so nothing downstream has to; `@octokit/rest` and `@octokit/auth-app`
are deliberately absent and must never be reintroduced. Its pure edges are
`@effected/semver` (for `GitTag.latestSemver`) and `@effected/github-references`
(a droppable compat re-export of six moved names).

## Import

```ts
import { GitHubClient, GitHubError, PullRequest, Repo, RepoRef } from "@effected/github";
import type { RepositoryPatch, RestParams } from "@effected/github";
```

Single entrypoint; no subpaths. Nothing here needs a platform package —
authentication is a `Redacted<string>` token or App credentials, and the
transport is `fetch`.

## Feature surface

| Reach for | When |
| --- | --- |
| `GitHubClient` | any route at all, including ones no resource service wraps — `request`, `paginate`, `paginateStream`, `graphql` |
| `Repo` | naming which repository a call targets; every resource method carries it in `R`, resolved per call |
| `GitHubApp` | minting, scoping and revoking installation tokens from App credentials, or building a client from them |
| `GitHubRepository` | repository settings: read, patch, apply a config blob, default branch, node id, owner type |
| `GitBranch`, `GitTag`, `GitCommit` | git-data plumbing — refs, trees, commits, committing files through the API without a checkout |
| `GitHubCommit`, `GitHubContent` | reading commit summaries, comparisons and changed files; reading a file at a ref |
| `PullRequest`, `PullRequestComment`, `GitHubIssue` | PR/issue lifecycle, marker-keyed comments, linked issues, auto-merge |
| `CheckRun` | reporting a job's verdict on a commit, ideally through the `withCheckRun` bracket |
| `GitHubRelease` | creating/updating releases and uploading assets |
| `WorkflowDispatch` | triggering a workflow and polling the run it started |
| `Attestation`, `ArtifactMetadata` | uploading a Sigstore bundle to GitHub, listing attestations for a subject digest |
| `RepositorySecret`, `RepositoryVariable`, `Ruleset`, `DeploymentEnvironment`, `RepositorySecurity`, `CodeScanning` | writing a repository's configuration, repeatedly, across a fleet |
| `TokenPermissions` | checking a token's grants against what an operation needs, before the call fails at GitHub |
| `GitHubError`, `RetryPolicy`, `RateLimitSnapshot` | routing failures and tuning retry |
| `GraphQLDocument` | a typed GraphQL query — a name, a document and a response codec |
| `RepoRef`, `BotIdentity`, `CommentMarker`, `PageOptions`, `CheckRunOutput` | pure values that reach nothing but `effect` and need no layer |

Task-level guides live elsewhere: `github-api` teaches calling the API,
`github-app-tokens` teaches App auth end to end. This file is the surface map.

## The route is the key

`client.request("GET /repos/{owner}/{repo}", { owner, repo })` types both the
parameters and the returned `data` from the route literal alone. No
`operation: string`, no callback, no type parameter, **no cast** — the design
property the whole package is organized around, and worth stating to a caller
tempted to reach for `as`.

- **`Rest.Params<R>`** intersects a three-field `RequestExtras` (`headers`,
  `mediaType`, `baseUrl`), deliberately not octokit's `RequestParameters` — that
  carries an index signature and accepts every typo. `RestData<R>`,
  `RestResponse<R>`, `RestRoute`, `RestPaginatingRoute` and `RestItem<R>` are the
  rest of the type vocabulary.
- **A route outside the generated map goes through `requestDecoded(route,
  params, schema)`, and the schema is mandatory** — the escape hatch is from the
  route table, never from typing. Two real cases: release-asset upload and the
  pinned-api-version attestation reads.
- **A hand-written route owns its query parameters in the template.** Nothing
  outside the map tells octokit that `name` is a query parameter, so
  `assets{?name}` must spell it or octokit drops it and GitHub answers 400.

## Core API

- **`GitHubClient`** — `Context.Service` with `request`, `requestDecoded`,
  `paginate` (array), `paginateStream` (`Stream`), `graphql`, and
  `rateLimit: Effect<Option<RateLimitSnapshot>>`. Layers:
  `layerFromToken({ token: Redacted, retry?, baseUrl?, userAgent?, fetch? })`;
  `layerFromConfig()`, which reads through the ambient `ConfigProvider` (not
  `process.env`) and fails with core's `ConfigError` — an honest "no token is
  configured", where the surface it replaced failed with a wire-failure type.
  **The App-authenticated layer is `GitHubApp.clientLayer`, not a third static
  here**, so a token-only consumer never links the JWT signer; a reachability
  test pins that.
- **`Repo` / `RepoRef`** — `RepoRef` is the pure `{ owner, repo }` value
  (`RepoRef.parse("owner/name")` → `Effect<…, InvalidRepoRefError>`,
  `parseResult` for the sync `Result`). `Repo` is the service every resource
  method requires in `R`; `Repo.layer(ref)`, `Repo.layerFromSlug`,
  `Repo.layerFromConfig`, and **`Repo.provide(ref)`** to run one effect against a
  different repository. **Resolution is per call, not at layer construction** —
  that is precisely what makes the scoped override work.
- **`GitHubError`** — one error for every REST resource: `kind` (`notFound |
  alreadyExists | rejected | unauthorized | rateLimited | transport | decode`),
  `operation`, `reason`, optional `status`, `retryAfterMillis`, `cause`.
  Classification happens **once**, in `GitHubError.fromOctokit`; nothing else in
  the package reads a status code. `GitHubError.hasKind(...kinds)` builds a
  predicate for `Effect.catchIf`. GraphQL fails with `GitHubGraphQLError`
  (carries `errors: GraphQLErrorEntry[]`), App auth with `GitHubAppError`
  (`kind: jwt | token | revoke | identity | installation`), and the pure
  comparator with `TokenPermissionError`.
- **`RetryPolicy` / `RateLimitSnapshot` / `PageOptions`** — `RetryPolicy.default`
  and `.none`, with `retries(failure)` and `delayFor(failure, attempt, random)`
  as pure functions; **the retry lives in the client and resources never retry**.
  `PageOptions.all` and `PageOptions.first(perPage)` bound a walk; every list
  read in the package paginates, and a first-page-only read is a bug class here,
  not a shortcut.
- **`GitHubApp`** — `token(request)` and `scopedToken(request)` (the scoped form
  revokes on scope close), `revoke`, `identity`, `installations`. `TokenRequest`
  is `{ appId, privateKey: Redacted } & { installationId?, owner? }`;
  `InstallationToken` carries `permissions`, `isExpired(nowMillis, skew?)` and
  `botIdentity()`. **`GitHubApp.clientLayer(request, options?)`** is how you get
  an App-authenticated `GitHubClient`.
- **`BotIdentity`** — `forApp({ appSlug, appUserId? })`, `githubActions`, and
  `signoff`, which renders the DCO trailer. A commit made through the Git Data
  API bypasses `git commit -s`, and a hand-built trailer fails late as a red DCO
  check.
- **`GitHubRepository`** — `settings`, `updateSettings(patch)`, `defaultBranch`,
  `nodeId`, `ownerType`, and `applySettings(record)` → `AppliedSettings`, which
  reports the REST and GraphQL keys that **actually went out**, in the caller's
  own names. `RepositorySettings` is `RestData<"GET /repos/{owner}/{repo}">`;
  `RepositoryPatch` is the PATCH route's params minus `owner`/`repo`;
  `GRAPHQL_ONLY_SETTINGS`, `SECURITY_ANALYSIS_STATUS_FIELDS` and
  `transformSecurityAndAnalysis` are the normalization vocabulary.
- **`repositoryPatch(draft)` / `RepositoryPatchDraft`** — the supported spelling
  for "apply only what was configured". Octokit spells an optional field
  `has_issues?: boolean` with no `| undefined`, so under
  `exactOptionalPropertyTypes` a consumer's `Partial<T>` does not assign to
  `RepositoryPatch` at all, and every consumer was writing the same `as`.
  `RepositoryPatchDraft` accepts explicit `undefined`; `repositoryPatch` **drops
  unset keys rather than sending `undefined`**, which is what PATCH semantics
  need — an absent field means "leave it alone", a present `undefined` is a
  value. **Documented residual:** a key-by-key loop (`draft[key] = source[key]`
  over a union `key`) still defeats TypeScript's correlation between two indexed
  accesses, and no helper fixes that — build the draft as a literal where you
  can. The single cast in the package lives inside this function.
- **`GitBranch` / `GitTag`** — `create`, `upsert` (`GitBranch.upsert` answers
  `BranchOutcome`: `"created" | "reset"`), `exists`, `sha`/`shaOption`, `reset`,
  `delete`, `list`, `resolve`, `GitBranch.createLinked` (the GraphQL
  issue-linked-branch mutation), and `GitTag.latestSemver({ prefix?,
  includePrerelease?, extract? })` → `Option<SemverTag>` over `@effected/semver`.
  **`kind: "alreadyExists"` is what makes these upserts implementable without a
  second existence check** — prefer the upsert to catching it yourself.
- **`GitCommit`** — `get(sha)` → `CommitRef`, `createTree({ changes, baseTree? })`,
  `createCommit({ message, tree, parents })`, `commitFiles({ branch, message,
  changes })`, over a `FileChange` union of `FileContent` (with `FileMode`
  `100644 | 100755 | 120000`) and `FileDeletion`. **Never spell a rebase as
  `GitBranch.upsert` then `commitFiles`**: that leaves a window in which the
  branch *is* the base, an open PR from it has an empty diff, and GitHub
  auto-closes it — a consumer lost a release PR to a ~3-second window while the
  run stayed green. Build the commit first and `upsert` once, to the finished
  sha.
- **`GitHubCommit` / `GitHubContent`** — `get`, `list`, `compare` →
  `CommitComparison`, `changedFiles` (a route octokit does not list as
  paginating, walked by the same one pagination engine); `getFile` /
  `getFileOption(path, { ref? })`.
- **`PullRequest`** — `get`, `list`, `listFiles`, `listAssociatedWithCommit`,
  `create`, `update`, `upsert` → `UpsertedPullRequest { pullRequest, created }`,
  `merge({ method?, commitTitle?, commitMessage? })`, `addLabels`,
  `requestReviewers`, and `setAutoMerge(pullRequest, method | "off")` — GraphQL,
  so it fails with `GitHubGraphQLError`.
- **`PullRequestComment` / `CommentMarker`** — `create`, `upsert(issueNumber,
  marker, body)`, `find`, `delete`. The marker is the existence check, appended
  in exactly `upsert`'s spelling; **two spellings of one sentinel is a duplicate
  comment every run**, invisible until it has happened a dozen times.
- **`GitHubIssue`** — `get`, `list`, `close(number, reason?)`, `comment`,
  `commentOnce(issueNumber, marker, body)` → `CommentOnceResult { wrote,
  comment }`, `linkedIssues(prNumber)` and `isCrossReferencedBy` (both GraphQL).
  **`commentOnce` creates or skips and never edits**; `upsert` edits in place.
  Pick by what the comment *is*: a status comment must converge on current
  truth, a one-time announcement must never be rewritten. Do not substitute
  `isCrossReferencedBy` for the marker — an issue reached through `linkedIssues`
  is cross-referenced from the moment the PR named it, so that check is already
  `true` before anything has been said. The remaining race (two runs both miss
  the marker, both post) is named, not designed away.
- **`CheckRun`** — `create(name, headSha)`, `get`, `update(id, output)`,
  `complete(id, conclusion, output?)`, and **`withCheckRun(name, headSha, use)`**,
  a bracket handing `use` an `id` and a `conclude` callback. `conclude`
  **records, it does not send**: the finalizer writes the verdict exactly once,
  on whichever path `use` leaves by, so an explicit conclusion survives a later
  failure or an interrupt. Its error channel is `never`. `CheckRunOutput` is
  pure, with `LIMIT_BYTES = 65535`, `MAX_ANNOTATIONS = 50` and `truncated()`.
- **`GitHubRelease`** — `create`, `getByTag`/`getByTagOption`, `list`, `update`,
  `uploadAsset(release, { name, data, contentType, label? })` (a hand-written
  route with two URI-template spellings, because an absent `label` would expand
  to a dangling `&`), `listAssets`.
- **`WorkflowDispatch`** — `dispatch(workflow, ref, inputs?)`, `runStatus`,
  `list`, `dispatchAndWait(workflow, ref, { inputs?, poll? })` with
  `PollOptions { interval?, timeout? }`. `list` reports GitHub's state string
  **without interpreting it** — whether a disabled workflow "counts" is a
  server-side rule this package cannot test.
- **`Attestation` / `ArtifactMetadata`** — `upload(bundle: unknown)` →
  `AttestationRecord` and `listForSubject(sha256, { predicateType? })`; the
  bundle crosses the seam **structurally**, so there is no `@effected/sbom` edge
  in either direction. `ArtifactMetadata.createStorageRecord(StorageRecordInput)`
  answers the raw bytes.
- **The configuration-write six** — `RepositorySecret` (`set`/`list`/`delete`
  over `SecretScope` = `actions | dependabot | codespaces`, plus the
  `*ForEnvironment` trio; values are `Redacted`), `RepositoryVariable` (same
  shape, plain strings), `Ruleset` (`upsert`/`list`/`delete`, plus `teamId` and
  `roleId` lookups), `DeploymentEnvironment`, `RepositorySecurity` (three
  getter/setter pairs) and `CodeScanning` (`configure`, `languages`). Two rules
  that cost real damage: **filter rulesets on `source_type` before matching by
  name** — the list mixes organization-inherited rulesets with the repository's
  own, and matching by name alone let a repository-scoped upsert `PUT` the
  *organization's* ruleset; and **secret writes carry the sealed box, which is
  not optional** — both the concatenation order and the 24-byte nonce are fixed
  by libsodium, and getting either wrong produces a box GitHub accepts and
  cannot decrypt.
- **`TokenPermissions`** — a **pure class, not a service**:
  `TokenPermissions.fromGitHub(record)`, then `compare(required)` →
  `PermissionResult { missing, extra }`, `assertSufficient(required)` and
  `assertExact(required)`. Feed it `InstallationToken.permissions`.
- **`GraphQLDocument.make({ name, document, response })`** — the typed GraphQL
  unit; `client.graphql(document, variables)` decodes through its codec.

## Testing machinery

Every service ships `makeTest(overrides?)` and `layerTest(overrides?)`: an
unstubbed member **dies naming itself**, because a fabricated response — an
empty list, a made-up sha — would leak into the code under test as fact. The
one recorded-response double is **`GitHubClient.layerFixture(fixtures)`**, which
builds a `PageSource` over the recorded arrays and hands it to the same
`paginate` engine the live client uses, so `perPage` and `maxPages` cannot
behave differently in a test than in production. `fixtures.unstubbed` chooses
`"die" | "fail" | "empty"`; `fixtures.requested` is appended to as the run
proceeds, so a suite can assert which routes were walked and at what page size.
A recorded `GitHubError` **is** the failure.

## Gotchas

- **Never add an import from `GitHubClient.ts` to `GitHubApp.ts`.** A
  reachability suite asserts `GitHubClient` does not reach
  `universal-github-app-jwt` while `GitHubApp` does; statics on one class share
  a module, which is why `clientLayer` lives where it does. The same suite pins
  the crypto pair to `RepositorySecret` alone, and asserts every module in
  `src/` is re-exported from `src/index.ts`.
- **Layer statics wrap the factory in an arrow** — `Layer.effect(this,
  Effect.map(GitHubClient, (client) => make(client)))`. Passing `make` directly
  throws `Cannot access 'make' before initialization` at import time while
  typechecking clean.
- **Import `blakejs` as a default import.** Node's `cjs-module-lexer` detects
  `blake2b` and not its nine siblings, so a named import works for one function
  and throws at runtime for its neighbour after a clean build.
- **There is no repository-settings service.** The endpoint belongs to
  `GitHubRepository`; a ported settings module was folded in the same day. Its
  name had collided with the `RepositorySettings` type alias and nothing said
  so — `tsc`, the bundler and API Extractor all accept a collision when a valid
  export of that name exists.
- **A normalizer must pass its own declared parameter type through untouched.**
  `updateSettings` accepts both a bare `"enabled"` in `security_and_analysis`
  and GitHub's own `{ status: "enabled" }`; the first version silently discarded
  the typed form while the request still returned 200.
- **The six issue-reference names re-exported here are compat only**, droppable
  at a later bump. New code takes `@effected/github-references` directly; the
  closing-list dialect is deliberately not re-exported.
