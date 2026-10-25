---
name: github-api
description: "Use when calling GitHub's REST or GraphQL API from Effect v4 code through @effected/github — typing a client.request call by route, choosing paginate vs paginateStream, building a GitBranch or GitTag upsert, classifying or catching a GitHubError, or wiring a resource service's layer. Also use when: client.request, requestDecoded, GitHubError, Repo, RetryPolicy, GraphQLDocument, TokenPermissions, CheckRunOutput, CommentMarker, GitBranch upsert, GitTag upsert, GitHub REST API, GitHub GraphQL API"
---

# `@effected/github`: calling GitHub from Effect v4

Typed GitHub REST and GraphQL over `@octokit/core`'s request surface, plus
the resource services (`GitBranch`, `PullRequest`, `GitHubIssue`, …) that
turn raw endpoints into domain operations. General Effect v4 rules — service
shapes, layer composition, memoization, `Schema.Class`, testing idioms —
live in `effect-v4-services-layers`, `effect-v4-schema`, `effect-v4-idioms`,
`effect-v4-testing`; this skill states only what `@effected/github` does
differently or as a worked instance.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `GitHubClient` (`.request`, `.requestDecoded`, `.paginate`, `.paginateStream`, `.graphql`, `.rateLimit`) | `import { GitHubClient } from "@effected/github"` | Calling any REST or GraphQL endpoint directly |
| `Repo` | `@effected/github` | Scoping a program to an `owner`/`repo` pair, or targeting a second repo mid-program |
| `RetryPolicy` | `@effected/github` | Configuring the client's one retry/backoff policy |
| `GitHubError`, `GitHubGraphQLError` | `@effected/github` | Classifying or catching a REST/GraphQL failure |
| `GraphQLDocument` | `@effected/github` | Building a typed GraphQL query or mutation |
| `GitBranch`, `GitTag`, `GitCommit` | `@effected/github` | Writing branches, tags, commits and trees through the Git Database API |
| `GitHubCommit` | `@effected/github` | Reading commits as GitHub reports them (not the Git Database API) |
| `GitHubRepository`, `GitHubContent` | `@effected/github` | Repo settings/default branch, or reading a file at a ref |
| `GitHubIssue`, `PullRequest`, `PullRequestComment` | `@effected/github` | Issues, PRs, and sticky PR/issue comments |
| `CheckRun`, `WorkflowDispatch` | `@effected/github` | Check runs, and dispatching/polling another workflow |
| `Attestation`, `ArtifactMetadata` | `@effected/github` | Uploading a signed attestation; artifact storage-record bookkeeping |
| `TokenPermissions`, `CheckRunOutput`, `CommentMarker`, `BotIdentity`, `RepoRef` | `@effected/github` | Pure classes — no layer, no service, testable standalone |

Full per-resource member signatures live in
[`references/resources.md`](references/resources.md) — this table is the
routing index, not the catalogue.

## Standards

- **Route through the literal.** `client.request(route, params)` types both
  `params` and the returned data from the route string alone — never invent
  an `operation: string` wrapper, a callback, or a cast; a cast in
  route-typed code is a defect, not a shortcut.
- **Let the route decide what's paginatable, at compile time.** `RestRoute`
  covers every documented route; `RestPaginatingRoute` is the narrower set
  `client.paginate` actually accepts, so a non-paginating route handed to it
  is rejected before the request is ever built. See
  [`references/pagination-retry-errors.md`](references/pagination-retry-errors.md)
  for the full type-level surface (`RestParams`, `RestData`, `RestExtras`).
- **`requestDecoded` is an escape hatch from the route table, never from
  typing.** Reach for it only when a route is absent from GitHub's OpenAPI
  map or its live shape diverges, and always pass the schema — a shape
  mismatch then fails typed (`kind: "decode"`) instead of trusting an
  unchecked value.
- **Resolve `Repo` per call, not once at construction.** The client is
  stable and built once; which repository a call targets is the caller's
  decision, and `Repo.provide(other)` must actually change it.
- **One retry policy, wired at the client layer.** Every resource inherits
  it; never give a resource its own retry logic, and never build a
  proactive rate limiter — read `client.rateLimit` and pace yourself if you
  need to.
- **Catch on `GitHubError.kind`, never a resource-specific tag.** One
  taxonomy, classified once by `GitHubError`'s shared classifier (`fromOctokit` / `fromResponse`) — a
  resource-specific error class has no successor to catch, and a real
  survey of consumers found a resource-specific tag matched almost never.
- **Prefer `GitBranch.upsert`/`GitTag.upsert` over a hand-rolled
  exists-then-create dance.** The library already resolves the
  `alreadyExists` race with a `create`-then-reset recovery; a caller
  catching `alreadyExists` itself is redoing work the library did for it.
- **Forward `PageOptions` on every paginating call; never hard-code `{}`.**
  `perPage` validates rather than clamps, so a caller asking for more than
  100 per page has a bug worth failing on at the boundary, not discovering
  in production.
- **Wrap a resource's `layer` factory in an arrow.** `Layer.effect(this,
  Effect.map(GitHubClient, (c) => make(c)))` — passing `make` directly
  throws at import time from the static initializer, not at layer-build
  time; every resource in the package follows this shape identically.
- **Pure classes need no layer.** `TokenPermissions`, `CheckRunOutput`,
  `CommentMarker`, `BotIdentity` and `RepoRef` reach nothing but `effect`;
  construct and test them directly, and don't wrap one in a `Context.Service`
  just to gain a double — there is nothing to mock.
- **Every resource ships `makeTest`/`layerTest`.** Every unstubbed member
  dies **when run**, naming itself: calling it only builds the effect, and
  the defect is in that effect's `Exit`, so assert with `Exit`/`Cause.hasDies`
  on the run, never with `assert.throws` around the call. A value member
  (`GitHubRepository.settings`) is the dying effect itself and the double
  still builds without it. Build a partial double from the member table, not
  from a stack trace. The octokit `fetch`-hook harness that exercises the
  real client end to end belongs to `testing-actions`.

## REST calendar versioning

Verified against the live API:

- **The client pins `x-github-api-version: 2026-03-10` on every request.**
  octokit itself sends no header, and without one GitHub serves its oldest
  supported calendar version (`2022-11-28`, sunset 2028-03-10). The pin is a
  `GitHubClientOptions.apiVersion` (and `GitHubAppOptions.apiVersion`)
  option, which must be `YYYY-MM-DD` (anything else dies at construction).
  **A GitHub Enterprise Server older than the default rejects it, so a client
  pointed at one must set `apiVersion`** to the newest version that server
  supports. The resolved value is `client.apiVersion`; calendar versions
  compare correctly as strings (`client.apiVersion < "2026-03-10"`).
- **The route types describe a different version than the one the client
  sends.** `client.request`'s params and `data` come from octokit's
  generated types, which describe GitHub's oldest supported api-version, not
  the default the client pins. So a route type can claim a field —
  `merge_commit_sha` on a pull request, `has_downloads` on a repository —
  that is `undefined` at runtime. Treat a field the pinned version removed
  as absent whatever the type says, and check the version's breaking-change
  list before reading a new one.
- **A per-call header wins over the option.** `Attestation` pins its own
  version per call through the typed `headers` extra (`RestExtras`, see
  [`references/pagination-retry-errors.md`](references/pagination-retry-errors.md)),
  and a client pinned elsewhere leaves it alone.
- **On the old default, GitHub adds `Deprecation`/`Sunset`/`Link` headers
  only on endpoints the new version CHANGED**, and octokit prints a warning
  for each that cannot be silenced (its fetch wrapper logs via
  `request.log ?? console`). That warning means "this client is on an old
  calendar version", not "this route is deprecated"; the fix is the pin,
  never a logging knob.
- **A calendar-version change REMOVES response fields, and an `optionalKey`
  decodes the absence clean.** `2026-03-10` removed `merge_commit_sha` from
  pull request objects, so `PullRequestInfo.mergeCommitSha` is read from
  GraphQL `mergeCommit.oid` instead, absent until the pull request merges
  (never the speculative test-merge sha). `get`, `update` and `upsert` always
  fill it; **`list` and `listAssociatedWithCommit` leave it absent unless
  called with `mergeCommits: true`**, which costs one GraphQL call per 100
  merged pull requests. All five carry `GitHubGraphQLError` in their error
  channel. Before projecting a new
  field off a REST response, check GitHub's breaking-change list for the
  pinned version.

## Footguns

- `GitTag.latestSemver` picks the **highest parsed version**, not the most
  recently created tag — in a monorepo with independently-versioned
  packages the two disagree; scope with `prefix` to the package you mean.
  See [`references/resources.md`](references/resources.md).
- A route absent from the generated paginating-route map (e.g.
  `GitHubCommit.changedFiles`) needs its own page source — never a manual
  loop that reimplements pagination beside the one real engine. See
  [`references/pagination-retry-errors.md`](references/pagination-retry-errors.md).
- A hand-written route (release-asset upload, attestation upload) owns its
  own query parameters in the URI template — a parameter passed only as an
  argument, never templated, gets silently dropped by octokit rather than
  rejected.
- `GitCommit` and `GitHubCommit` are easy to confuse: writing a commit onto
  a tree is `GitCommit` (Git Database API, no subprocess); reading what a
  commit says is `GitHubCommit` (the higher-level commits API).

## Out of scope — see the named skill

- GitHub App authentication, token lifecycle, client constructors →
  `github-app-tokens`.
- Check runs and PR comments as a reporting workflow (as opposed to the raw
  member catalogue) → `actions-reporting`.
- The octokit `fetch`-hook test harness → `testing-actions`.
- Attestation upload as part of a sign/SBOM pipeline →
  `supply-chain-attestation`.

## Additional resources

- [references/resources.md](references/resources.md) — the full per-resource
  member catalogue: every service's methods, signatures and return shapes.
  Load when: you need a specific method's signature or return type for any
  of the fourteen resource services.
- [references/pagination-retry-errors.md](references/pagination-retry-errors.md) —
  the route-typing type-level surface (`RestParams`, `RestData`,
  `RestExtras`, `RestPaginatingRoute`), the pagination engine's
  request-budget semantics, the retry/backoff schedule, and the full
  `GitHubError`/`GitHubGraphQLError` classification and GraphQL-document
  mechanics. Load when: typing a route by hand, tuning a paginating call,
  debugging a retry sequence, or classifying/catching a GitHub error.
