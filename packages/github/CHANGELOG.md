# @effected/github

## 0.6.0

### Features

* ### `GitHubIssue.commentOnce`

  Post a marked comment on an issue exactly once — create it, or skip if it's already there:

  ```ts
  import { CommentMarker } from "@effected/github";

  const marker = CommentMarker.make({ namespace: "my-action", key: "status" });
  const result = yield* issues.commentOnce(42, marker, "Build succeeded.");
  // result.wrote: true if this call created the comment, false if it already existed
  // result.comment: the marked comment either way
  ```

  This is create-or-skip, never edit — the counterpart to `PullRequestComment.upsert`, which edits in place. The marker is appended to the body exactly as `upsert` formats it, so either surface can find the other's comment; the existence check paginates the issue's comments looking for it. Closes effected#306.

  ### `IssueReferences`

  A new pure module for GitHub's closing-keyword reference grammar — no service, no layer, just strings in and values out:

  ```ts
  import { CLOSING_KEYWORDS, harvestIssueReferences, parseBareLineReference } from "@effected/github";

  harvestIssueReferences("fixes #12 and closes #13");
  // every inline closing reference in the text, in document order, each with its keyword and offsets

  parseBareLineReference("Closes: #12");
  // Option.some({ issueNumber: 12, keyword: "closes" }) — the bare-line dialect, colon optional
  ```

  `harvestIssueReferences` covers the inline-in-prose dialect GitHub itself scans PR bodies for (mandatory whitespace, no colon); `parseBareLineReference` covers a generated references region's one-reference-per-line dialect (colon optional). `CLOSING_KEYWORDS` lists the nine documented keywords both dialects derive from. Closes effected#194. [#397][#397]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#397]: https://github.com/spencerbeggs/effected/pull/397

## 0.5.0

### Refactoring

* Adopted effect rc.108's relocation of `SchemaError` into the `Schema` module: the GraphQL `decode` signature now types its failure as `Schema.SchemaError`. The error surface is unchanged; no consumer action is required. [#389][#389]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.4.0 | 0.5.0 |

* | Dependency | Type           | Action  | From           | To           |
  | :--------- | :------------- | :------ | :------------- | :----------- |
  | effect     | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.4.3

### Bug Fixes

* ### `has_discussions` now routes through GraphQL instead of being silently dropped

  `GitHubRepository.applySettings` sent `has_discussions` to the REST patch, which ignores unknown fields and answers 200 — so the setting was reported as applied on every run while the repository never changed. It now routes through the GraphQL arm as `hasDiscussionsEnabled` (verified against `UpdateRepositoryInput` by live introspection), alongside `has_sponsorships` and `has_pull_requests`.

  Also documented: `GitHubIssue.isCrossReferencedBy`'s two guard hazards (issues obtained from `linkedIssues` answer `true` from the outset; sidebar-connected issues without a cross-reference read `false`), and `PullRequestInfo.body`'s wire behavior — present via `get` and `list`, absent (never `""`) when GitHub sends `null` — is now pinned by tests. [#375][#375]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#375]: https://github.com/spencerbeggs/effected/pull/375

## 0.4.2

### Bug Fixes

* `GitHubIssue`'s REST calls now pin `x-github-api-version: 2026-03-10`, eliminating the `Deprecation` header warning `@octokit/request` was printing straight to consumer workflow logs under the previous default calendar version. [#366][#366]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#366]: https://github.com/spencerbeggs/effected/pull/366

## 0.4.1

### Documentation

* `CodeScanning.configure` now records that turning default setup back to `not-configured` **does not remove the synthetic CodeQL workflow** GitHub created when it was enabled — it stays listed among the repository's workflows. A caller treating "default setup is off" as "no CodeQL workflow exists", or counting workflows to decide whether a repository has CI, will be wrong. Observed against a real organization rather than inferred from the API description.
* `RepositoryVariable.set` now states that its 404-for-absent existence check is **documented, not probed** — no suite has issued that read against real GitHub. If the assumption is wrong, every write takes the create branch, so a surprising `alreadyExists` from the `POST` is evidence about the assumption rather than about the caller. [#354][#354]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#354]: https://github.com/spencerbeggs/effected/pull/354

## 0.4.0

### Breaking Changes

* An unstubbed route now dies rather than failing typed. A test that asserted `GitHubError.notFound` from an absent fixture sets `unstubbed: "fail"` to keep the old behaviour.

  `GitHubFixtures.requested` is typed `Array<RecordedCall>` rather than `Array<{ route, perPage }>`. A test that declares the array with the old inline type needs the new one — the elements now carry `kind` and `params` as well. Assertions that compared whole recorded entries need those two fields added. [#352][#352]

### Features

* ### `layerFixture` records every call, with params

  `GitHubFixtures.requested` previously logged paginated reads only, as `{ route, perPage }`. `request`, `requestDecoded` and `graphql` named their arguments `_params` / `_variables` and appended nothing, so a suite whose methods all go through `request` could assert the route it hit but nothing about what it sent.

  It now records every surface, as the new `RecordedCall`:

  ```ts
  const requested: Array<RecordedCall> = [];
  const layer = GitHubClient.layerFixture({ request: { "GET /repos/{owner}/{repo}": data }, requested });

  // after the call:
  // [{ kind: "request", route: "GET /repos/{owner}/{repo}", params: { owner: "acme", repo: "widgets" } }]
  ```

  `kind` distinguishes `request` / `requestDecoded` / `paginate` / `graphql`; `params` carries what the call was made with (GraphQL variables for `graphql`, whose `route` is the document name); `perPage` still appears on paginated reads.

  This closes the gap that made a consumer hand-roll an \~80-line harness to test resource modules whose every method goes through `request`.

  ### An unstubbed route now dies instead of failing

  A route with no fixture entry used to fail with `GitHubError.notFound`. It now **dies**, naming the route — the same treatment an absent `graphql` fixture has always had, and consistent with the rest of the kit's rule that wiring mistakes are defects rather than domain errors.

  The reason for the change is worth knowing, because a typed failure looks strictly safer: **it is only loud in code that does not catch.** A consumer whose methods each catch `GitHubError` and report it — a per-resource sync, for instance — turns a missing stub into a *different execution path* rather than a failure. The assertions then fail for a new reason, and nothing in any message names a fixture. That cost one consumer 28 tests reading as ordinary logic bugs.

  Two opt-outs, via the new `unstubbed` field:

  ```ts
  GitHubClient.layerFixture({ unstubbed: "fail" })   // the old typed notFound
  GitHubClient.layerFixture({ unstubbed: "empty" })  // {} for a request, no items for a page
  ```

  Use `"fail"` when the suite's subject *is* 404 handling — though stubbing the 404 explicitly is better. Use `"empty"` for a suite whose subject is decisions rather than endpoints. `graphql` ignores the field and always dies: its payload is decoded against the document's schema, so no empty value would satisfy it.

- ### Six repository resource services, and an extension to a seventh

  Secrets, variables, rulesets, deployment environments, security features and CodeQL default setup — route families this package did not cover at all — plus four settings behaviours folded onto the existing `GitHubRepository`. Ported from `@spencerbeggs/reposets`, restructured onto this package's `Repo`-from-context convention.

  | Service                       | Covers                                                                                                                                                                                        |
  | :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `GitHubRepository` (extended) | the GraphQL `updateRepository` mutation, `security_and_analysis` folding, dependent-merge-key dropping and `ownerType` — folded into the existing service rather than shipped as a second one |
  | `RepositorySecret`            | Actions / Dependabot / Codespaces / environment secrets, with sealed-box encryption                                                                                                           |
  | `RepositoryVariable`          | Actions and environment variables                                                                                                                                                             |
  | `Ruleset`                     | ruleset CRUD, team-slug and org-role resolution                                                                                                                                               |
  | `DeploymentEnvironment`       | deployment environments                                                                                                                                                                       |
  | `RepositorySecurity`          | vulnerability alerts, automated fixes, private vulnerability reporting                                                                                                                        |
  | `CodeScanning`                | CodeQL default setup and repository language detection                                                                                                                                        |

  No method takes `owner`/`repo`: every one resolves `Repo` per call and carries it in `R`, so `Repo.provide` redirects a program at another repository — the same contract `GitBranch` and its neighbours already keep.

  ```ts
  const program = Effect.gen(function* () {
    const settings = yield* RepositorySettings
    yield* settings.update({ has_issues: true, has_sponsorships: true })
  })

  // One program, many repositories.
  yield* program.pipe(Repo.provide(RepoRef.make({ owner: "acme", repo: "widget" })))
  ```

  ### Secrets are encrypted client-side, and the value is `Redacted`

  `RepositorySecret.set` takes a `Redacted.Redacted<string>`, fetches the store's public key and sends a libsodium sealed box; the plaintext never crosses the wire. The single `Redacted.value` unwrap happens at the moment of encryption.

  `tweetnacl` and `blakejs` are new runtime dependencies, and neither ties this package to Node: `blakejs` is pure JavaScript, and `tweetnacl` feature-detects `getRandomValues` before falling back to Node's `crypto`. The sealing itself uses core's `Encoding` and `TextEncoder`, so **`src` imports no runtime builtin at all**.

  A public key that is not valid base64 fails as a typed `GitHubError` naming the route it came from, rather than throwing — garbage from the API is input, and input failures are typed.

  ### `WorkflowDispatch.list` — ask whether a repository has workflows

  ```ts
  const workflows = yield* (yield* WorkflowDispatch).list;
  // ReadonlyArray<WorkflowInfo>: { id, name, path, state }
  ```

  Nothing in this package could answer that question before. It matters for CodeQL setup: `actions` is a real CodeQL language, and GitHub validates it against **workflow files** — which repository *languages* can never report, because those come from linguist. A consumer offering CodeQL setup otherwise had to request `actions` blindly and absorb a 422, or drop it for every repository including the ones where it is valid.

  `state` is GitHub's own string (`active`, `disabled_manually`, …), reported rather than interpreted: whether a *disabled* workflow counts for a given GitHub feature is that feature's server-side rule, which this package cannot test, so it does not encode a guess. Filter on it yourself if you care. A repository with no workflows is an empty array, not a failure.

  ### `updateSettings` now prepares the patch it sends

  `GitHubRepository.updateSettings` gained two transformations, so an existing method's behaviour changed:

  * **`security_and_analysis` is normalised.** A bare `"enabled"` / `"disabled"` is wrapped into the `{ status }` form GitHub requires; an already-wrapped value passes through untouched. Both shapes now work, and a block that is neither is dropped rather than sent.
  * **Dependent merge keys are dropped when their strategy is disabled.** Sending `merge_commit_title` in the same request that sets `allow_merge_commit: false` is a 422 from GitHub, so those keys now travel only with the strategy that owns them.

  If you were assembling either shape by hand before calling `updateSettings`, that work is now done for you and doing it yourself is still correct — the wrapped form is passed through, not re-wrapped.

  ### `applySettings` reports what it sent

  It now returns `AppliedSettings` — `{ rest, graphql }`, the field names that actually went out — instead of `void`.

  The reason is a dry run. `applySettings` drops what GitHub would reject, so a caller reporting `Object.keys(desired)` describes its own *intent* while this package decides the *content*. The two agree right up until a field is dropped, which is exactly the case someone reading a plan is checking. Both lists use the caller's key names, not the wire names, because the audience is a person reading the plan against the config they wrote.

  Deriving the drop rule a second time downstream would be worse than the original mistake, since nothing fails when the copy drifts.

### Bug Fixes

* ### List reads were truncated to one page

  Every list read in the new services — secrets, variables, rulesets, deployment environments, workflows — used a single request, which returns **one page**. A repository with more items than a page holds reported a subset that looked complete.

  The most consequential was `Ruleset.upsert`: its existence check is what decides create-versus-update, so past the first page an existing ruleset was invisible and an update became a create. `RepositoryVariable.set` had the same shape.

  All of them paginate now. The symptom to recognise, if you have been reading these listings: the array length disagrees with GitHub's own `total_count`.

  ### A repository-scoped write can no longer overwrite an organization's ruleset

  **This is a live defect in `@spencerbeggs/reposets` v3 and anyone running that shape should treat it as a security fix.**

  `GET /repos/{owner}/{repo}/rulesets` returns rulesets **inherited from the organization** alongside the repository's own. Matching a ruleset by name alone therefore lets a repository-scoped call issue a `PUT` against the **organization's** ruleset id — rewriting policy for *every repository the organization owns*, from a caller that never mentioned the organization and had no intention of changing anything beyond one repository.

  `Ruleset.upsert` filters on `source_type` before matching, so an inherited ruleset can never be the target of a write. Removing that predicate fails two tests, one of which places the organization's ruleset first in the listing precisely so a `find` without the filter takes it.

  ### A type-correct `security_and_analysis` is no longer silently dropped

  Caught in review before this shipped: the first version of the patch preparation above wrapped bare strings only, so a caller passing the shape `RepositoryPatch` actually declares — `{ advanced_security: { status: "enabled" } }`, GitHub's own parameter type — had the entire block discarded on the way out. The request still succeeded, and the setting was never applied. [#352][#352]

### Dependencies

* | Dependency | Type       | Action | From | To    |                                                                       |
  | ---------- | ---------- | ------ | ---- | ----- | --------------------------------------------------------------------- |
  | blakejs    | dependency | added  | —    | 1.2.1 |                                                                       |
  | tweetnacl  | dependency | added  | —    | 1.0.3 | [#352][#352] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#352]: https://github.com/spencerbeggs/effected/pull/352

## 0.3.0

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.2 | 0.4.0 |

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.3

### Documentation

* `PullRequest.list` now documents that its `head` option accepts either a qualified `owner:ref` or a bare `ref`, which is qualified with the current repo's owner automatically. For a pull request opened from the current repository, feeding `PullRequestInfo.head` — the bare ref — straight back into the filter round-trips correctly, so consumers filtering client-side to work around the raw REST route no longer need to. The docs also state the limit: `PullRequestInfo` drops the source owner, so the round trip does not hold for a fork-originated pull request, where qualifying with the current owner names a branch in the wrong account and matches nothing.
* `GitTag.latestSemver` now states that "newest" means highest version, not most recent, and that it is the wrong instrument for a monorepo publishing independently versioned packages. Version ordering and recency are unrelated there, so the result can sit several releases behind the head and never move, with nothing visible to signal it. Filter by the package's tag prefix instead.
* `PullRequestInfo` and the private `RawPull` wire interface now cross-reference each other, naming which is the domain shape and which is what GitHub answers with. The two differ in exactly the places that matter (`head`/`headSha` versus a nested `head: { ref, sha }`, `url` versus `html_url`). [#268][#268]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.3.1 | 0.3.2 |

* | Dependency       | Type       | Action  | From  | To    |                                                          |
  | ---------------- | ---------- | ------- | ----- | ----- | -------------------------------------------------------- |
  | @effected/semver | dependency | updated | 0.3.1 | 0.3.2 | Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#268]: https://github.com/spencerbeggs/effected/pull/268

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
