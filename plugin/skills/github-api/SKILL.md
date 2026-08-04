---
name: github-api
description: Use when calling GitHub's REST or GraphQL API from Effect v4 code through @effected/github — typing a client.request call by route, choosing paginate vs paginateStream, building a GitBranch or GitTag upsert, classifying or catching a GitHubError, or wiring a resource service's layer.
when_to_use: client.request, requestDecoded, GitHubError, Repo, RetryPolicy, GraphQLDocument, TokenPermissions, CheckRunOutput, CommentMarker, GitBranch upsert, GitTag upsert, GitHub REST API, GitHub GraphQL API
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
  taxonomy, classified once in `GitHubError.fromOctokit` — a
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
  dies naming itself; build a partial double from the member table, not
  from a stack trace. The octokit `fetch`-hook harness that exercises the
  real client end to end belongs to `testing-actions`.

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
  the pagination engine's request-budget semantics, the retry/backoff
  schedule, and the full `GitHubError`/`GitHubGraphQLError` classification
  and GraphQL-document mechanics. Load when: tuning a paginating call,
  debugging a retry sequence, or classifying/catching a GitHub error.
