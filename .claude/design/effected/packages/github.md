---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 90
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../roadmap.md
  - commands.md
  - git.md
  - semver.md
---

# @effected/github design

## Overview

`@effected/github` is the kit's **typed GitHub API layer**: one client over GitHub's REST and
GraphQL endpoints, plus the resource services that turn raw endpoints into domain operations
(branches, commits, tags, contents, issues, releases, pull requests, comments, check runs,
workflow dispatch, attestations). It replaces the GitHub half of
`@savvy-web/github-action-effects@3.1.0` and is **Phase 2** of the
[GitHub/Actions split program](../../../plans/2026-07-25-github-split-master.md) — the deepest
design in it, because everything downstream (`github-actions`, `sbom`, the five consumer repos)
sits on this surface.

Three properties define the package, and each is a correction of a measured failure in the
package it replaces:

1. **Nothing is `unknown`.** octokit ships a complete, generated, **types-only** description of
   every GitHub endpoint. The old `rest<T>(operation: string, fn: (octokit: any) => …)` threw all
   of it away and pushed the typing burden onto consumers, who paid it in **16 cast sites across
   four repos** and ~30 more casts inside the library itself
   ([evidence §2.3, §2.4](#evidence)). Here the endpoint route **is** the key, and both the
   parameters and the response data come from it. See [The typed REST surface](#the-typed-rest-surface-rest).
2. **A light consumer cannot reach a heavy engine.** The old package put octokit, `@octokit/auth-app`'s
   ~492 KB OAuth arm, CycloneDX and Sigstore behind one entry point, which is why silk-sync-action
   ships an 11-line bundler ignore list for XML libraries it never invokes (evidence §8.4). Here the
   split is structural: **`layerFromToken` and `layerFromApp` live in different modules**, and no
   namespace object gathers them. See [Bundle reachability](#bundle-reachability).
3. **Errors are sized to what consumers read.** Across six repos, consumers read `reason` (≈40×),
   `status` (2×), `operation` (2×), `errors` (1×) and `_tag` (1×) — and nothing else. The old
   surface was **18 error classes** demanding up to five mandatory fields each. Here it is
   [four errors](#error-model), few mandatory fields, ergonomic statics, and "already exists" as a
   **structural discriminant** on both the REST and the GraphQL path.

Scope is closed by the six consumer repos, not by GitHub's API. An endpoint earns a resource
method when a consumer needs it typed; everything else is reachable through the typed
`client.request` without a cast, so "not modelled" never means "not usable".

### Evidence

This design is written against a read-only survey of the source package and all six consumers,
with every claim carried at `file:line` — the Phase 2 evidence pack (1,426 lines, eight sections:
20 service shapes, the three client constructors, all 16 consumer cast sites, five extracted
GraphQL documents, the error-field read census, the §7 gap call sites, the rate-limit autopsy,
the auth internals, and the octokit dependency weights). Section references below (`evidence §N`)
are to that pack. Where this doc contradicts spec §4/§7, the pack's correction stands: the
`update-release-branch.ts:653-700` sites are **REST casts, not GraphQL**, and the real third
GraphQL consumer is silk-sync-action's `src/sync/projects.ts`.

## Tier and dependencies

**Integrated tier**, by [R1/R2](../effect-standards.md#dependency-policy) — it owns the octokit
runtime. That is the whole reason the package exists: interpreting GitHub's API is a concern that
should exist once, typed, in a package named for it, so that `github-actions` and the consumer
repos never take an octokit edge themselves.

The dependency set is **deliberately smaller than the package it replaces**, and every line of it
is decided against measured weights (evidence §8.2, re-verified against the installed tree at
`savvy-web/systems/node_modules/.pnpm`).

| Dependency | On disk | Runtime bytes | Why |
| --- | --- | --- | --- |
| `@octokit/core` | 48 KB | yes | The `Octokit` class: `request` (route-keyed and fully typed via `@octokit/types`) and `graphql`. Pulls `request` (100 KB), `endpoint` (180 KB), `graphql` (76 KB), `auth-token` (72 KB), `request-error` (24 KB), plus `before-after-hook`, `universal-user-agent`, `content-type`, `json-with-bigint`. |
| `@octokit/plugin-paginate-rest` | 256 KB (mostly generated types) | small | `composePaginateRest` (works against a **bare core instance**) and `iterator`, plus `PaginatingEndpoints` — the type that lets us statically reject paginating a non-paginating route. |
| `@octokit/types` | 364 KB | **zero** | `dist-types` only — the package ships **no JavaScript** (verified: its only entries are `dist-types/`, `package.json`, `LICENSE`, `README.md`). Carries the generated `Endpoints` map; drags `@octokit/openapi-types` (4.5 MB, also types-only). |
| `universal-github-app-jwt` | 80 KB, **zero dependencies** | yes, App path only | Signs the GitHub App JWT (RS256 over WebCrypto, with a Node conditional export that converts PKCS#1 → PKCS#8). This is the exact leaf `@octokit/auth-app` itself uses for JWTs. |
| `@effected/semver` (`workspace:~`) | — | small | `GitTag.latestSemver`. Pure tier, so [R3](../effect-standards.md#dependency-policy) applies and the edge is free. |

`effect` is a peer (`catalog:effect:peers`). `@effect/platform-node` appears in `devDependencies`
only, for integration suites.

### Two dependencies the old package had, deliberately dropped

**`@octokit/rest` — dropped.** It is a 36 KB convenience wrapper (its entire `index.d.ts` is nine
lines) that bundles two plugins: `plugin-request-log`, which the old package immediately
neutralized with a `silentOctokitLog` sink, and `plugin-rest-endpoint-methods`, **1.4 MB of
generated types** whose `RestEndpointMethodTypes` map is a second spelling of information
`@octokit/types` already carries. The evidence pack proposed keying the typed surface on
`RestEndpointMethodTypes`; the source check found a better key. `@octokit/core`'s `request` is
already typed against `@octokit/types`' generated `Endpoints` map:

```ts
// @octokit/types/dist-types/RequestInterface.d.ts
<R extends Route>(route: EndpointKeys | R, options?: R extends EndpointKeys
  ? Endpoints[R]["parameters"] & RequestParameters : RequestParameters
): R extends EndpointKeys ? Promise<Endpoints[R]["response"]> : Promise<OctokitResponse<any>>
```

So route-keyed typing needs **neither plugin**. Dropping `@octokit/rest` removes the request-log
plugin, 1.4 MB of duplicate endpoint types, and the value-level `octokit.rest.repos.get` namespace
surface that made every consumer hand-write a `{ rest: { repos: { get: … } } }` interface to
describe it.

**`@octokit/auth-app` — dropped, its JWT engine kept.** Its `index.d.ts:2` re-exports
`createOAuthUserAuth` from `@octokit/auth-oauth-user`, so `createAppAuth` makes **~492 KB of OAuth
app/user/device-flow machinery reachable** even though the package only ever calls the
`{type:"app"}` and `{type:"installation"}` overloads (evidence §8.2). What we actually need from it
is two things: an RS256-signed app JWT, and `POST /app/installations/{id}/access_tokens`. The
second is a **typed route on the client we already have** (verified present in the `Endpoints` map,
along with `DELETE /installation/token`, `GET /app/installations` and `GET /app`). The first is
`universal-github-app-jwt` — 80 KB, zero dependencies, and `@octokit/auth-app`'s own JWT
dependency, so this is not a re-implementation of crypto: it is taking the same leaf directly and
leaving the OAuth arm behind.

Consequences worth recording:

- The `OctokitAuthApp` service **disappears entirely**. It existed only to make `createAppAuth`
  mockable, had no test double, and its shape was a non-effectful function returning a function —
  the exact `Layer.mock`-degrading shape the program bans (spec §6). With the JWT reduced to one
  leaf call, the seam is an internal function, and `GitHubApp.layerTest` is the test story.
- `GitHubApp`'s `R` **loses `HttpClient`**. Today's `layerFromApp` requires
  `HttpClient.HttpClient` because `GitHubAppLive` hand-rolls installation discovery over
  `effect/unstable/http`, including a `Link: rel="next"` regex pager
  (`layers/GitHubAppLive.ts:39-71`). Routing those calls through the same octokit transport gives
  one HTTP path, one error taxonomy, one retry policy and one rate-limit reader — and deletes the
  hand-rolled pager, since `GET /app/installations` is a `PaginatingEndpoints` route.
- **Documented constraint, unchanged from today:** `universal-github-app-jwt` converts a PKCS#1
  key (`-----BEGIN RSA PRIVATE KEY-----`, which is what github.com hands you) to PKCS#8 **only
  under the `node` export condition**; on a non-Node runtime a PKCS#1 key fails with an explicit
  error. `@octokit/auth-app` has exactly the same constraint via the same leaf, so this is not a
  regression — but it is now ours to document, and it is why `GitHubAppError` carries a
  `kind: "jwt"` case with a real message rather than a wrapped defect.

**Net effect on a consumer's tree: ~492 KB of OAuth machinery and 1.4 MB of duplicate endpoint
types removed**, with no capability lost against what any of the six consumers exercises.

## Bundle reachability

The [tree-shakability non-negotiable](../../../plans/2026-07-25-github-split-master.md#non-negotiables-kit-wide-from-the-specs-probe-findings--house-standards)
is a measured, paying invariant. This is how the package structurally honors it.

| A consumer that imports… | links | does **not** link |
| --- | --- | --- |
| `GitHubClient`, `Repo`, `Rest`, any resource service | `@octokit/core`, `@octokit/plugin-paginate-rest` | `universal-github-app-jwt` |
| `GitHubApp` (or `GitHubApp.clientLayer`) | the above **plus** `universal-github-app-jwt` | — |
| `TokenPermissions`, `BotIdentity`, `CommentMarker`, `CheckRunOutput`, `RepoRef`, `RetryPolicy` | nothing but `effect` | all octokit |

Three mechanisms, in order of how much they carry:

1. **Module-per-layer-variant.** `GitHubClient.layerFromToken` / `.layerFromConfig` live in
   `src/GitHubClient.ts`, which imports only `@octokit/core` and the paginate plugin. The
   App-authenticated client layer lives in `src/GitHubApp.ts`, the only module that imports the JWT
   signer. silk-router-action — the one consumer of six that is a pure token-only REST reader, and
   which today links the whole OAuth arm anyway (evidence §8.3) — reaches none of it.
2. **No namespace object, anywhere.** The old
   `export const GitHubClientLive = { fromEnv, fromToken, fromApp } as const`
   (`layers/GitHubClientLive.ts:419-423`) is precisely what defeats mechanism 1: a namespace object
   is a single live binding, so referencing it retains every member's whole module graph
   ([effect-standards](../effect-standards.md#no-barrel-re-exports)). `index.ts` re-exports by name
   only; `"sideEffects": false` stays in the manifest.
3. **The pure surface is genuinely pure.** `TokenPermissions` (a comparator that in the old package
   was a service with a `Layer.succeed` live and **zero** octokit —
   `layers/TokenPermissionCheckerLive.ts:80-125`), `BotIdentity`, `RepoRef`, `CommentMarker`,
   `CheckRunOutput`'s byte-budgeting and `RetryPolicy` are Schema classes in modules that import
   nothing but `effect`. A consumer that only needs to compare token permissions bundles a few
   hundred bytes.

**This invariant gets a test, not a promise.** See [Testing](#testing) — a build-output
reachability check asserts `universal-github-app-jwt` is absent from the module graph of a program
that imports only `GitHubClient`. The old package's failure mode was invisible until someone
measured a bundle; this makes it a red suite.

## Module map

Module-per-concept, no barrels, `src/index.ts` re-exports only.

| Module | Owns | Heaviest import |
| --- | --- | --- |
| `src/Rest.ts` | the route-keyed type vocabulary: `Route`, `Params`, `Data`, `PaginatingRoute`, `Item`, `PageOptions`, `Page` | `@octokit/types` (types only) |
| `src/GitHubClient.ts` | the `GitHubClient` service; `layerFromToken`, `layerFromConfig`; `GitHubError` | `@octokit/core` |
| `src/GitHubApp.ts` | `GitHubApp` service, `InstallationToken`, `GitHubAppError`, `BotIdentity`, `GitHubApp.clientLayer` | `universal-github-app-jwt` |
| `src/Repo.ts` | `RepoRef` value class, the `Repo` context service and its layers | `effect` |
| `src/Resilience.ts` | `RetryPolicy`, the one retry schedule, `RateLimitSnapshot` | `effect` |
| `src/GraphQL.ts` | `GraphQLDocument`, `GitHubGraphQLError`, the owned documents | `effect` |
| `src/GitBranch.ts` | branch refs: `create`, `upsert`, `exists`, `sha`, `reset`, `delete` | — |
| `src/GitCommit.ts` | trees, commits, refs, `commitFiles`, `get` | — |
| `src/GitTag.ts` | tag refs, peeling, `latestSemver` | `@effected/semver` |
| `src/GitHubRepository.ts` | `repos.get` projections: `defaultBranch`, `nodeId`, `settings`, `updateSettings` | — |
| `src/GitHubCommit.ts` | commit reads: `get`, `list`, `compare`, `changedFiles` | — |
| `src/GitHubContent.ts` | `getFile` | — |
| `src/GitHubIssue.ts` | issues + the owned issue GraphQL documents | — |
| `src/GitHubRelease.ts` | releases and assets | — |
| `src/PullRequest.ts` | pull requests incl. `listAssociatedWithCommit`, `upsert`, auto-merge | — |
| `src/PullRequestComment.ts` | sticky comments, `CommentMarker` | — |
| `src/CheckRun.ts` | check runs, `CheckRunOutput` with byte budgeting | — |
| `src/WorkflowDispatch.ts` | dispatch + poll-to-completion | — |
| `src/TokenPermissions.ts` | **pure** permission comparison, `TokenPermissionError` | `effect` |
| `src/Attestation.ts` | the attestation REST surface (upload/list) | — |
| `src/ArtifactMetadata.ts` | `createStorageRecord` | — |
| `src/internal/` | the octokit factory, the pagination engine, error mapping, rate-limit header parsing | — |

Twenty-one public modules against the old package's 20 services — but three services are gone
(`RateLimitState`, `RateLimiter`, `OctokitAuthApp`), one becomes a pure class
(`TokenPermissionChecker` → `TokenPermissions`), one folds into the client (`GitHubGraphQL`), and
three are new (`Rest`, `Repo`, `GitHubRepository`).

## The typed REST surface (`Rest`)

### The mechanism: the route is the key

```ts
// src/Rest.ts — types only; this module emits no runtime code.
import type { Endpoints, RequestHeaders } from "@octokit/types";
import type { PaginatingEndpoints } from "@octokit/plugin-paginate-rest";

/** Every REST route GitHub documents, e.g. `"GET /repos/{owner}/{repo}"`. */
export type Route = keyof Endpoints;

/** Transport knobs octokit accepts on any route, narrowed to the three we allow. */
export interface RequestExtras {
  readonly headers?: RequestHeaders;
  readonly mediaType?: { readonly format?: string };
  readonly baseUrl?: string;
}

/** The parameters `route` accepts — path, query and body, plus the extras. */
export type Params<R extends Route> = Endpoints[R]["parameters"] & RequestExtras;

/** The `data` payload `route` returns. */
export type Data<R extends Route> = Endpoints[R]["response"]["data"];

/** The subset of routes that paginate. */
export type PaginatingRoute = keyof PaginatingEndpoints;

/** One element of a paginating route's collection. */
export type Item<R extends PaginatingRoute> = Items<PaginatingEndpoints[R]["response"]["data"]>;
type Items<D> = D extends ReadonlyArray<infer T> ? T
  : D extends { readonly items: ReadonlyArray<infer T> } ? T : never;
```

Two deliberate narrowings against octokit's own surface:

- **`Params<R>` intersects a three-field `RequestExtras`, not octokit's `RequestParameters`.**
  `RequestParameters` carries `[parameter: string]: unknown`, and intersecting it would silently
  accept every typo. The three fields we keep are the ones the evidence proves are needed:
  `headers` (release-asset `content-type`, the pinned attestations `X-GitHub-Api-Version`),
  `mediaType.format` (raw content reads) and `baseUrl` (`uploads.github.com` for release assets).
  Everything else a caller might reach for is a real parameter and is already typed.
- **`Item<R>` is derived here** because the plugin's own `GetResultsType` (which handles the
  array-vs-`{total_count, items}` split) is not exported. Ten lines, one place, and it makes
  `paginate` return `ReadonlyArray<PullRequest>` rather than `unknown[]`.

### The client shape

```ts
// src/GitHubClient.ts
export interface GitHubClientShape {
  /** One request. Returns the response `data`, typed by the route. */
  readonly request: <R extends Rest.Route>(
    route: R,
    params: Rest.Params<R>,
  ) => Effect.Effect<Rest.Data<R>, GitHubError>;

  /**
   * A route GitHub does not document in its OpenAPI schema, or one whose live shape
   * differs from it (a pinned preview api-version). The Schema is mandatory — this is
   * an escape hatch from the *route table*, never from typing.
   */
  readonly requestDecoded: <A, I>(
    route: string,
    params: Record<string, unknown> & Rest.RequestExtras,
    schema: Schema.Codec<A, I>,
  ) => Effect.Effect<A, GitHubError>;

  /** Collect every page, honoring `perPage` and `maxPages`. */
  readonly paginate: <R extends Rest.PaginatingRoute>(
    route: R,
    params: Rest.Params<R>,
    options?: Rest.PageOptions,
  ) => Effect.Effect<ReadonlyArray<Rest.Item<R>>, GitHubError>;

  /** The same traversal as a Stream; the caller decides when to stop. */
  readonly paginateStream: <R extends Rest.PaginatingRoute>(
    route: R,
    params: Rest.Params<R>,
    options?: Rest.PageOptions,
  ) => Stream.Stream<Rest.Item<R>, GitHubError>;

  /** A typed, owned GraphQL document with its variables. */
  readonly graphql: <A, V>(
    document: GraphQLDocument<A, V>,
    variables: V,
  ) => Effect.Effect<A, GitHubGraphQLError>;

  /** The most recent rate-limit headers this client saw, if any. */
  readonly rateLimit: Effect.Effect<Option.Option<RateLimitSnapshot>>;
}

export class GitHubClient extends Context.Service<GitHubClient, GitHubClientShape>()(
  "@effected/github/GitHubClient",
) {
  static readonly layerFromToken: (options: {
    readonly token: Redacted.Redacted<string>;
    readonly retry?: RetryPolicy | "off";
    readonly baseUrl?: string;
    readonly userAgent?: string;
  }) => Layer.Layer<GitHubClient>;

  /** Reads `GITHUB_TOKEN` (overridable) through the ambient `ConfigProvider`. */
  static readonly layerFromConfig: (options?: {
    readonly name?: string;
    readonly retry?: RetryPolicy | "off";
  }) => Layer.Layer<GitHubClient, ConfigError>;

  static readonly makeTest: (overrides?: Partial<GitHubClientShape>) => GitHubClientShape;
  static readonly layerTest: (overrides?: Partial<GitHubClientShape>) => Layer.Layer<GitHubClient>;
  /** An honest recorded-fixture double; see [Testing](#testing). */
  static readonly layerFixture: (routes: Rest.Fixtures) => Layer.Layer<GitHubClient>;
}
```

Every member is an `Effect`, a `Stream`, or a function returning one — including `rateLimit`, which
is an Effect-valued property, the core paradigm (`ChildProcessSpawner.exitCode` is written the same
way). So the whole shape stays `Layer.mock`-optional and `Partial<Shape>`-stubbable.

`operation: string` is gone. There is nothing left for it to name: the route names the endpoint,
and the span carries it. silk-release-action's invented `"pulls.list.validation"` key
(`src/main.ts:695`) has no successor and needs none.

### Fluency proof: three real rewrites

**1. mm's `resolveBaseBranch`** — `claude-code-marketplace-manager/src/services/ManifestCommitter.ts:12-19,48-58`.
Eight lines of hand-written interface plus eleven lines of code, to read one string:

```ts
// BEFORE
/** Minimal shape of the octokit `repos.get` REST method, cast from `unknown`. */
interface ReposGetOctokit {
  readonly rest: { readonly repos: {
    readonly get: (args: { owner: string; repo: string }) => Promise<{ data: { default_branch: string } }>;
  } };
}
// …
const client = yield* GitHubClient;
const { owner, repo } = yield* client.repo;
const { default_branch } = yield* client.rest<{ default_branch: string }>("repos.get", (octokit) =>
  (octokit as ReposGetOctokit).rest.repos.get({ owner, repo }));
return default_branch;

// AFTER
return yield* GitHubRepository.defaultBranch;
```

`GitHubRepository.defaultBranch` is one narrow typed projection; the raw form,
`client.request("GET /repos/{owner}/{repo}", { owner, repo })`, is also fully typed with no
interface to write. Note that silk-sync-action wants **sixteen** repo-settings fields from the same
endpoint (`src/github/reads.ts:6-24`) and silk-release-action wants `node_id`
(`create-release-branch.ts:74-76`), which is why the projection accessors and the faithful full
response both exist — a `{default_branch}`-only accessor would not have been enough.

**2. mm's branch-upsert TOCTOU** — `ManifestCommitter.ts:91-116`. A seven-line comment plus a
nine-line workaround on top of a three-call preamble, up to **four round trips for one intent**,
written that way because `GitBranchError` had no structured "already exists" discriminant:

```ts
// BEFORE (abridged; the full block is :91-116)
const currentSha = yield* branch.getSha(params.branch);        // or a failure path
const exists = yield* branch.exists(params.branch);
if (exists) { yield* branch.reset(params.branch, baseSha); }
else {
  // TOCTOU: another concurrent run can create this branch between the
  // `exists` check above and this `create` call. The library's
  // GitBranchError carries no structured "already exists" discriminant
  // (just a free-form `reason` string), so re-checking existence after a
  // failure — rather than string-matching the message — is the robust
  // way to tell "someone else already created it" from a real failure. […]
  yield* branch.create(params.branch, baseSha).pipe(
    Effect.catchTag("GitBranchError", (error) =>
      Effect.flatMap(branch.exists(params.branch), (existsNow) =>
        existsNow ? branch.reset(params.branch, baseSha) : Effect.fail(error))));
}

// AFTER
yield* GitBranch.upsert(params.branch, baseSha);
```

`upsert` is `POST /repos/{owner}/{repo}/git/refs` and, on a `kind: "alreadyExists"` failure,
`PATCH …/git/refs/{ref}` with `force: true` — **one round trip in the common case, two in the
raced one**, and the recovery still *resets* rather than inheriting a branch a concurrent creator
rooted elsewhere, which is the semantics the comment was defending. The mirror-image dance at
silk-release-action `create-release-branch.ts:316-339` (update-then-create) collapses onto the
same call, and `GitTag.upsert` exists for the same reason (`releases.test.ts:338,429` string-encode
`"Reference already exists"` twice).

**3. silk-router-action's PR-for-commit lookup** —
`src/services/phase-detector.ts:119-129`, the one `biome-ignore lint/suspicious/noExplicitAny` in
the whole survey:

```ts
// BEFORE
gh.rest<ReadonlyArray<AssociatedPR>>(
  "listPullRequestsAssociatedWithCommit",
  // biome-ignore lint/suspicious/noExplicitAny: Octokit shape is opaque to the library
  async (octokit: any) =>
    octokit.rest.repos.listPullRequestsAssociatedWithCommit({ owner, repo, commit_sha: github.sha }),
)
// + a hand-written `interface AssociatedPR { number; merged_at; head; base }` at :17-22

// AFTER
yield* PullRequest.listAssociatedWithCommit(github.sha);   // ReadonlyArray<PullRequestInfo>
```

The method **already existed** (`services/PullRequest.ts:74`) and this repo did not find it; the
`any` was a discoverability failure as much as a typing one. Both are addressed: the method is
named for what it answers, and the fallback path — `client.request("GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls", …)`
— is typed anyway. (The poll-until-a-domain-predicate half of that call site is **not** ours; it is
`@effected/github-actions`' Phase 3 friction fix. See [Actions decoupling](#actions-decoupling).)

**And the ones inside the library.** ~30 `as` / `as unknown as` casts in the old Live layers
(`PullRequestLive.ts` alone has ten) exist for exactly the same reason and all vanish: with a typed
route, the Live implementation's projection from response to domain model is a checked mapping, not
a cast.

## Pagination model

Three defects to fix, all evidenced (§5.6):

- Six Live call sites pass `{}` and thereby silently accept `perPage = 100` with no caller control
  (`GitHubCommitLive.ts:88,113`, `PullRequestLive.ts:146,162`, `GitTagLive.ts:118`,
  `GitHubReleaseLive.ts:171`).
- `PullRequestCommentLive.ts:66-71,111-116` does not paginate at all — a PR with >100 comments
  silently loses its sticky-comment marker.
- The shipped test double **ignores both options** (its parameters are literally named `_options`),
  so truncation logic is structurally untestable.

```ts
// src/Rest.ts
export class PageOptions extends Schema.Class<PageOptions>("PageOptions")({
  /** Items per page. GitHub's ceiling is 100; values outside 1..100 fail typed. */
  perPage: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  /** Stop after this many pages. Absent means "until GitHub stops". */
  maxPages: Schema.optionalKey(Schema.Int.check(Schema.isPositive)),
}) {}
```

Rules:

1. **Every paginating method takes `PageOptions` and forwards it.** No method hard-codes `{}`. This
   is checked by a test that drives each resource's list method through a counting fixture and
   asserts the page requests it issued.
2. **`perPage` is validated, not clamped.** A caller asking for 250 has a bug — GitHub silently
   caps at 100 and the caller's arithmetic is then wrong. Failing typed at the boundary is the
   [input-hardening](../effect-standards.md#input-hardening-standards) posture.
3. **Both a collected and a streaming form**, and they share one engine. `paginate` is
   `paginateStream(...).pipe(Stream.runCollect)`; the stream is built on
   `Stream.fromAsyncIterable(composePaginateRest.iterator(octokit, route, params), …)` (verified:
   `Stream.fromAsyncIterable` exists at `Stream.ts:1458`; `composePaginateRest` composes against a
   bare `@octokit/core` instance). `maxPages` is applied inside the iterator adapter so the
   traversal *stops issuing requests* rather than filtering after the fact — the old hand-rolled
   loop (`GitHubClientLive.ts:225-277`) is deleted, along with its two subtly different
   stop conditions.
4. **`PaginatingRoute` is enforced.** Handing `paginate` a non-paginating route is a compile error,
   which the old `paginate(operation: string, fn)` could never express.

`PullRequestComment.find` paginates. `GitTag.list(prefix)` still filters client-side after
fetching — GitHub has no server-side ref prefix filter for `GET /repos/{owner}/{repo}/tags` — but
`latestSemver` short-circuits it (see [`GitTag`](#resources)).

## Error model

Four errors, all `Schema.TaggedErrorClass`, replacing eighteen `Data.TaggedError`s. Sized to the
read census (evidence §4.3): `reason` ≈40×, `status` 2×, `operation` 2×, `errors` 1×, `_tag` 1×,
and **zero** reads of `retryable`, `retryAfterMs`, `alreadyExists`, `prNumber`, `branch`, `tag`,
`name` or `workflow`.

```ts
// src/GitHubClient.ts
export class GitHubError extends Schema.TaggedErrorClass<GitHubError>()("GitHubError", {
  /** Structural routing. This is what replaces every string sniff. */
  kind: Schema.Literals([
    "notFound",       // 404
    "alreadyExists",  // 422/409 whose body says the ref/resource exists
    "rejected",       // any other 4xx — validation, policy, conflict
    "unauthorized",   // 401/403 without rate-limit evidence
    "rateLimited",    // 403/429 with rate-limit or Retry-After evidence
    "transport",      // 5xx, network failure, aborted request
    "decode",         // a response that did not match its declared Schema
  ]),
  /** What was being attempted, e.g. `"GitBranch.upsert"` or the raw route. */
  operation: Schema.String,
  /** Human-readable cause. The field 40 consumer sites interpolate. */
  reason: Schema.String,
  status: Schema.optionalKey(Schema.Int),
  /** Server-advised delay. Written by the client, read only by the retry schedule. */
  retryAfterMillis: Schema.optionalKey(Schema.Int),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  static readonly notFound: (operation: string, subject: string) => GitHubError;
  static readonly alreadyExists: (operation: string, subject: string) => GitHubError;
  static readonly rejected: (operation: string, status: number, reason: string) => GitHubError;
  /** The boundary mapper: an unknown octokit throwable becomes a classified GitHubError. */
  static readonly fromOctokit: (operation: string, error: unknown) => GitHubError;
  /** Predicate for `Effect.catchIf`. */
  static readonly hasKind: (...kinds: ReadonlyArray<GitHubError["kind"]>) =>
    (error: GitHubError) => boolean;
  /** Derived, not stored — `kind` already carries it. */
  get retryable(): boolean;
}
```

Design consequences, each traceable:

- **One error for every REST resource, not one per resource.** Consumers `catchTag` a specific
  resource error exactly **once** in six repos (mm `ManifestCommitter.ts:110`, and that site
  disappears with `GitBranch.upsert`). `operation` names the resource method, `kind` carries the
  routing, and eighteen near-identical classes with eighteen near-identical `mapError` closures
  (evidence §4.2 lists all thirteen mapper sites) collapse into one classification step in
  `internal/`. This mirrors `@effected/git`, where the design rule is *no consumer ever
  string-matches stderr* and classification happens once.
- **`retryable` is derived, `retryAfterMs` survives as optional.** Both had zero consumer reads;
  `retryable` is now a getter over `kind`, and `retryAfterMillis` stays a field only because the
  [retry schedule reads it off the error](#resilience-one-policy-driven-by-githubs-own-headers).
  It is the one field with a live internal reader and no external one, and it is optional.
- **"Already exists" is first-class on both channels.** `GitHubError.kind === "alreadyExists"` and
  `GitHubGraphQLError.kind === "alreadyExists"`. The GraphQL half closes silk-sync-action
  `src/sync/projects.ts:34-37`, which today lowercases the message and greps for `"already"` or
  `"exists"`. **And the upsert path makes even that unnecessary** for the branch and tag cases —
  the discriminant exists so the *library* can implement `upsert`; consumers should not need it.
- **`SchemaError` never escapes.** `requestDecoded` and `graphql` normalize a decode failure into
  `kind: "decode"` with the `SchemaError` on `cause`, per the
  [error standards](../effect-standards.md#error-handling-standards).
- **Statics cover every hand-construction site.** All six consumer test sites (evidence §4.4)
  become one-liners: `Effect.fail(GitHubError.notFound("GitHubRelease.getByTag", tag))`,
  `Effect.fail(GitHubError.alreadyExists("GitTag.create", tag))`.

The other three:

```ts
export class GitHubGraphQLError extends Schema.TaggedErrorClass<GitHubGraphQLError>()(
  "GitHubGraphQLError", {
    kind: Schema.Literals(["alreadyExists", "rejected", "unauthorized", "rateLimited", "transport", "decode"]),
    /** The document's name, e.g. `"closingIssuesReferences"`. */
    operation: Schema.String,
    reason: Schema.String,
    errors: Schema.Array(Schema.Struct({ message: Schema.String, type: Schema.optionalKey(Schema.String) })),
    retryAfterMillis: Schema.optionalKey(Schema.Int),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class GitHubAppError extends Schema.TaggedErrorClass<GitHubAppError>()("GitHubAppError", {
  kind: Schema.Literals(["jwt", "token", "revoke", "identity", "installation"]),
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

// src/TokenPermissions.ts — raised by a pure comparison, so it carries the comparison
export class TokenPermissionError extends Schema.TaggedErrorClass<TokenPermissionError>()(
  "TokenPermissionError", { kind: Schema.Literals(["insufficient", "excess"]), result: PermissionResult },
) {}
```

`GitHubGraphQLError` keeps `errors` because it is the one structured field a consumer reads
(silk-sync-action `projects.ts:36`) and because GraphQL genuinely returns a list. `operation` names
the **document**, not the literal string `"graphql"` the old client passed for every call
(`GitHubClientLive.ts:282`).

## Resilience: one policy, driven by GitHub's own headers

The old package shipped **four** retry policies (`withResilience`, `resilienceSchedule`,
`GitBranchLive.retryOnTransient`, `RateLimiter.withRetry` — the last with no `while` predicate, so
it retried permission denials), and consumers added two more. It also shipped a rate-limit
subsystem — `RateLimitState` (a bare `Ref` as a service shape, structurally unmockable) and
`RateLimiter` — with **zero production consumers across all six repos** (evidence §6.4). Nobody
provides `RateLimitState.Default`, nobody wires `RateLimiterLive`, nobody calls `withRateLimit`,
nobody passes a `ResilienceOptions`. Worse, both writer and reader resolve the state through
`Effect.serviceOption`, so forgetting to provide it degrades the whole feature **silently** — no
error, no warning, no type signal.

Designing from zero users, the recommendation is: **delete the subsystem and keep one policy inside
the client.**

```ts
// src/Resilience.ts
export class RetryPolicy extends Schema.Class<RetryPolicy>("RetryPolicy")({
  maxRetries: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),   // default 4
  baseDelay: Schema.DurationFromMillis,                                          // default 1s
  maxDelay: Schema.DurationFromMillis,                                           // default 30s
  /** Honor `retry-after` / `x-ratelimit-reset` over the computed backoff. */
  respectRetryAfter: Schema.Boolean,                                             // default true
  /** Refuse to sleep longer than this for a server-advised delay; fail instead. */
  maxServerAdvisedDelay: Schema.DurationFromMillis,                              // default 60s
}) {
  static readonly default: RetryPolicy;
  /** The Schedule this policy compiles to. */
  schedule(): Schedule.Schedule<Duration.Duration, GitHubError>;
}

export class RateLimitSnapshot extends Schema.Class<RateLimitSnapshot>("RateLimitSnapshot")({
  remaining: Schema.Int, limit: Schema.Int, resetAt: Schema.DateTimeUtcFromString,
}) {}
```

The schedule is built with **`Schedule.fromStepWithMetadata`** (verified at `Schedule.ts:377`),
whose step receives `InputMetadata<Input>` carrying `input` — the `GitHubError` being retried — and
`attempt` (`Schedule.ts:87-95`). That is the v4-native construct for "the delay depends on the
failure", and it is why the old package's hand-rolled recursive retry loop
(`layers/resilience.ts:87-111`, explicitly *not* `Effect.retry`) is unnecessary:

- `kind ∈ {"transport", "rateLimited"}` retries; everything else fails immediately. There is no
  path on which a permission denial is retried.
- If `respectRetryAfter` and the error carries `retryAfterMillis`, that is the delay — unless it
  exceeds `maxServerAdvisedDelay`, in which case the error is re-failed rather than slept through
  (a 45-minute rate-limit reset must surface as a failure, not a hang).
- Otherwise, full jitter in `[0, min(baseDelay · 2^attempt, maxDelay)]`.

Wired once, in the client layer (`{ retry?: RetryPolicy | "off" }`), so **every resource inherits
it and no resource has its own**. `GitBranchLive`'s per-op `retryOnTransient` — a third policy
layered on top of the client's — has no successor.

**Rate-limit headers stay, as an observable value, not a shared cell.** The client parses
`x-ratelimit-remaining` / `-limit` / `-reset` off every REST response into a `Ref` held **inside
the layer's own closure**, surfaced as `client.rateLimit: Effect<Option<RateLimitSnapshot>>`. That
is one member on one shape: mockable via `Partial<Shape>`, observable in tests, impossible to
forget to provide, and impossible to desynchronize from the client that writes it. The dead
`observedAt` field is dropped.

**No proactive throttling in v1.** `RateLimiter.withRateLimit`'s sleep-or-fail gate had zero users
and duplicated what the reactive path now handles correctly: GitHub answers an exhausted budget
with a 403/429 plus reset headers, which classifies as `kind: "rateLimited"` and gets the
server-advised delay. A consumer that wants to pace itself has `client.rateLimit` and can build a
gate; if a second consumer asks, it arrives additively as `RetryPolicy`-adjacent vocabulary.

**No edge to `@effected/commands`' `Retry`.** That module classifies `CommandFailedError` over a
subprocess transport; this one classifies `GitHubError` over HTTP. Sharing would require a
cross-package error contract to buy a shared word. What the two packages do share is a
**convention** — each owns "which of my failures are transient", exposes it, and lets the caller
compose `Effect.retry` — and that convention is worth stating in
[effect-standards](../effect-standards.md) rather than encoding as a dependency.

## Auth: `GitHubApp`, and where `layerFromApp` lives

### The module split, reconciled with `static layer`

The house convention is `static readonly layer` on the service class, with variants as `layerFromX`
suffixes. That convention and the reachability invariant collide exactly once: `GitHubClient` has
three constructors, one of which needs the JWT signer, and **statics on one class must share one
module**. Putting `GitHubClient.layerFromApp` in `GitHubClient.ts` would make every
`layerFromToken` consumer's import reach `universal-github-app-jwt`.

**Resolution: the module that owns the heavy edge owns the layer.**

```ts
// src/GitHubClient.ts — imports @octokit/core only
GitHubClient.layerFromToken({ token })       // Layer<GitHubClient>
GitHubClient.layerFromConfig()               // Layer<GitHubClient, ConfigError>

// src/GitHubApp.ts — the only module importing universal-github-app-jwt
GitHubApp.layer                              // Layer<GitHubApp, never, GitHubClient>
GitHubApp.clientLayer({ appId, privateKey, installationId? })
                                             // Layer<GitHubClient, GitHubAppError>
```

`GitHubApp.clientLayer` is a `layer`-family static that produces **a different service's** layer.
The kit has this precedent already: `@effected/workspaces` ships `Workspaces.localExecLayer`, which
produces `@effected/commands`' `LocalExec` ([commands.md](commands.md#the-workspaces-edge-contract-inversion-and-why-it-is-not-optional)).
The naming rule that generalizes both: **a `<service>Layer` / `clientLayer` static belongs to the
module that owns the dependency the layer needs, not to the module that declares the service** —
because a static cannot cross a module boundary and a dependency must not. Recorded as a deliberate
deviation with its reason, per the standards' divergence rule.

`layerFromEnv` does not survive under that name. Its successor is
`GitHubClient.layerFromConfig()`, which reads `Config.redacted("GITHUB_TOKEN")` (verified:
`Config.redacted` at `Config.ts:1268`; `Config<T> extends Effect<T, ConfigError>` at
`Config.ts:108`, so it is directly yieldable) through the ambient `ConfigProvider` rather than
`process.env`. Three things improve at once: the layer is testable by providing a
`ConfigProvider`, it is not Actions-coupled, and its construction error becomes **`ConfigError`** —
an honest "no token is configured" — instead of a `GitHubClientError`, which is a wire-failure type
and is why silk-router-action wrote a five-line comment justifying `Layer.orDie`
(`src/layers/app.ts:8-13`). A consumer may now simply let `ConfigError` sit in the layer's `E`.

### Token lifecycle

```ts
export interface GitHubAppShape {
  /** Mint an installation token. Discovers the installation when `installationId` is absent. */
  readonly token: (options: TokenRequest) => Effect.Effect<InstallationToken, GitHubAppError>;
  /** Mint under a Scope, revoking on scope close (best-effort). */
  readonly scopedToken: (options: TokenRequest) =>
    Effect.Effect<InstallationToken, GitHubAppError, Scope.Scope>;
  readonly revoke: (token: Redacted.Redacted<string>) => Effect.Effect<void, GitHubAppError>;
  /** `GET /app` + the bot-user lookup; enriches a token with slug/name/user id. */
  readonly identity: (options: IdentityRequest) => Effect.Effect<AppIdentity, GitHubAppError>;
  readonly installations: Effect.Effect<ReadonlyArray<Installation>, GitHubAppError>;
}
```

```ts
export class InstallationToken extends Schema.Class<InstallationToken>("InstallationToken")({
  token: Schema.RedactedFromValue(Schema.String),   // decodes to Redacted, encodes to the raw string
  expiresAt: Schema.DateTimeUtcFromString,
  installationId: Schema.Int,
  permissions: Schema.Record(Schema.String, Schema.String),
  appSlug: Schema.optionalKey(Schema.String),
  appUserId: Schema.optionalKey(Schema.Int),
  appName: Schema.optionalKey(Schema.String),
}) {
  /** Modelled AND enforced — see below. */
  isExpired(now: DateTime.Utc, skew?: Duration.Duration): boolean;
  botIdentity(): BotIdentity;
}
```

Five deliberate changes:

- **Expiry is enforced, not merely persisted.** Today `expiresAt` is stored and read by nobody, and
  a `main` phase outliving the ~60-minute token simply starts 401ing (evidence §7.2). `isExpired`
  exists, `GitHubApp.clientLayer` re-mints when the held token is inside a one-minute skew window
  of expiry, and a 401 on a minted token retries **once** after a forced re-mint. This is the one
  place the client's retry policy is not sufficient, because the fix is not "wait" but "get a new
  token".
- **`botIdentity` moves off the service shape.** It is a synchronous member today
  (`services/GitHubApp.ts:82-85`) and therefore `Layer.mock`-required, degrading every mock to a
  full implementation. It becomes `BotIdentity`, a pure Schema class in `GitHubApp.ts` with statics
  — `BotIdentity.forApp({ appSlug, appUserId, appName })` and `BotIdentity.githubActions` (the
  well-known `41898282+github-actions[bot]@users.noreply.github.com`) — plus the
  `InstallationToken.botIdentity()` instance method above. **Not** wrapped in `Effect.succeed`; the
  skill names that as the anti-pattern.
- **Installation discovery is env-free and unpaged-by-hand.** `resolveInstallationId` currently
  matches installations against `process.env.GITHUB_REPOSITORY`'s owner
  (`layers/GitHubAppLive.ts:85-96`) — env-coupled auth inside the auth layer. Here it matches
  against the `Repo` service's owner when one is provided, or takes an explicit `owner` option, and
  it walks `GET /app/installations` through the client's real paginator instead of a
  `Link: rel="next"` regex.
- **`identity` keeps its documented quirk.** `GET /users/{slug}[bot]` rejects an app JWT, so it
  bears the installation token when one is supplied and otherwise runs unauthenticated at 60
  req/h/IP. That is GitHub's behavior, not a defect; it stays, documented, with the unauthenticated
  path surfaced as a `kind: "identity"` failure rather than a silent degrade.
- **Revocation stays best-effort and stays `token`-not-`Bearer`.** `DELETE /installation/token`
  with `Authorization: token <value>`, accepting 204 or any 2xx — GitHub is specific about this and
  the current code is right.

### The seam `@effected/github-actions` needs

`GitHubToken` — the five-function bridge that provisions a token, persists it in `ActionState`,
masks it via `ActionOutputs.setSecret`, and disposes it in `post` — **stays out of this package**;
it is Actions-shaped by construction (evidence §7.3). What this package owes it is a surface it can
build on without reaching inside:

| github-actions needs | github provides | Member usage |
| --- | --- | --- |
| mint a token in `pre` | `GitHubApp.token(options)` | `token` |
| mint with automatic revocation | `GitHubApp.scopedToken(options)` | `token`, `revoke` |
| enrich with bot identity | `GitHubApp.identity(options)` | `identity` |
| persist across the process boundary | `InstallationToken` is a `Schema.Class` with a **JSON-encodable** encoded form (`token` encodes to the raw string, `expiresAt` to an ISO string) | — |
| rebuild a client in `main` from the persisted token | `GitHubClient.layerFromToken({ token })` | — |
| revoke in `post` | `GitHubApp.revoke(token)` | `revoke` |
| render a committer identity | `BotIdentity.forApp(...)` / `InstallationToken.botIdentity()` | — (pure) |

**As-built clarification (round-1 handoff under-specified this):**
`GitHubApp`'s own `TokenRequest` (this package) carries only
`installationId?`/`owner?` beside the `AppCredentials` pair — no scope field,
because this package never verifies permissions itself. Scope verification
lives one level up, in `@effected/github-actions`' `GitHubToken.provision`,
whose `ProvisionOptions` requires `appId`/`privateKey` explicitly (no
discovery) and names the scope-check field `required`, **not**
`permissions` — `permissions` is reserved for what `InstallationToken`
reports GitHub actually granted. Do not read the two packages' options
shapes as sharing a field set; only `appId`/`privateKey`/`installationId`/
`owner` are common between them.

That member-usage column is the spec's explicit ask (spec §6, "`UnimplementedError` roulette") and
it is documented **here, per exported member**, so a partial mock in github-actions can be built
from the table rather than from a stack trace.

Two things this package deliberately does **not** do, both because they are the caller's concern:
**masking** (`setSecret` is an Actions output command) and **persistence** (`GITHUB_STATE` stores
plaintext by GitHub's protocol — a `Redacted` cannot survive that boundary by design, which is the
Phase 3 cross-process question the decisions log already records).

## The repo coordinate

`process.env.GITHUB_REPOSITORY` is read in **three** places today
(`GitHubClientLive.ts:294`, `GitHubAppLive.ts:85`, and transitively by every `client.repo` caller),
which is what couples the GitHub client to the Actions runtime. It becomes a first-class value with
its own service.

```ts
// src/Repo.ts
export class RepoRef extends Schema.Class<RepoRef>("RepoRef")({
  owner: Schema.NonEmptyString, repo: Schema.NonEmptyString,
}) {
  static parseResult(slug: string): Result.Result<RepoRef, InvalidRepoRefError>;
  static readonly parse: (slug: string) => Effect.Effect<RepoRef, InvalidRepoRefError>;
  get slug(): string;   // "owner/repo"
}

export class Repo extends Context.Service<Repo, RepoRef>()("@effected/github/Repo") {
  static readonly layer: (ref: RepoRef) => Layer.Layer<Repo>;
  static readonly layerFromSlug: (slug: string) => Layer.Layer<Repo, InvalidRepoRefError>;
  /** Reads `GITHUB_REPOSITORY` through the ambient ConfigProvider — the env-driven variant. */
  static readonly layerFromConfig: (options?: { readonly name?: string }) =>
    Layer.Layer<Repo, ConfigError | InvalidRepoRefError>;
  /** Scoped override: run `effect` against a different repository. */
  static readonly provide: (ref: RepoRef) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.Effect<A, E, Exclude<R, Repo>>;
}
```

Every resource service takes `Repo` in its `R` and no method takes an `{owner, repo}` argument —
which is what makes `GitHubRepository.defaultBranch` a single expression in the fluency rewrite
above. `Repo.provide(ref)` is what makes the multi-repo case work, and it is the *better* answer for
silk-sync-action, which loops over target repositories:

```ts
yield* Effect.forEach(targets, (target) => syncOneRepo.pipe(Repo.provide(target)), { concurrency: 4 });
```

**A deliberate, recorded exception to "no non-effectful members on a service shape."** `Repo`'s
entire shape is one immutable value class — it is data, not an IO contract. `Layer.mock` is
meaningless for it (there is nothing to leave unimplemented), `Layer.succeed` is the correct double,
and there is no pure helper hiding inside an IO API. The rule exists to stop a sync member from
silently degrading a *mixed* shape's mock; a value-only service has no mock to degrade. The boundary
to hold: this is legitimate only when the shape is **entirely** one value with no methods. The
moment a method appears, it is a service and the rule applies.

## Resources

Every service below: `Context.Service<Self, Shape>()("@effected/github/<Name>")`, every member an
`Effect`/`Stream` or a function returning one, `static readonly layer` using `this`, plus
`makeTest(overrides?: Partial<Shape>)` and `layerTest(overrides?)` where anything unstubbed **dies
loudly**. Signatures are abridged to the shape and the decisions; `E` is `GitHubError` unless noted.

**As built**, each resource `layer` requires only `GitHubClient` and each *method* requires `Repo` —
see [as-built correction 1](#as-built--where-implementation-corrected-the-design). `GitTag`
additionally reaches `@effected/semver`.

**`GitBranch`** — `create(name, sha)`, **`upsert(name, sha)`**, `exists(name) → boolean`,
`sha(name) → string`, `reset(name, sha)`, `delete(name)`. `exists` degrades 404 to `false` (the
`@effected/git` `show` invariant, same shape). `upsert` is the headline: one intent, one call.

**`GitCommit`** — `createTree(entries, baseTree?)`, `createCommit(message, treeSha, parents)`,
`updateRef(ref, sha, options?)`, `commitFiles(branch, message, files)`, and **`get(sha) →
CommitRef`** where `CommitRef = { sha, treeSha, parents }`. That last one is new and deletes two
byte-duplicate consumer casts: silk-release-action reaches for `git.getCommit` purely to get
`tree.sha` for a `base_tree`, at both `create-release-branch.ts:301-313` and
`update-release-branch.ts:697-709`, with a comment explaining that the Git Data API wants a tree
SHA. With `GitCommit.get` and `GitBranch.sha`, `commitChangesOntoTarget`'s whole `GitHubClient`
requirement drops out of its signature (evidence §3.4). `TreeEntry`/`FileChange` stay tagged unions
discriminating content from deletion.

**`GitTag`** — `create`, **`upsert`**, `delete`, `list(prefix?, options?)`, `resolve(tag) → sha`
(peeling annotated tags, `MAX_TAG_PEEL = 5`, failing typed past it), and **`latestSemver(options?)
→ Option<SemverTag>`**. The last replaces 35 lines at silk-release-action
`link-issues-from-commits.ts:142-176` that ran **one `Effect.result` per parse and one per
comparison**. Here parsing and comparison are `SemVer.parseResult` and `SemVer.compare` — both
sync, both already in `@effected/semver` (`SemVer.ts:159,220`) — so the whole selection is one pass
over the page stream with no Effect round trips. `SemverTag = { tag, sha, version: SemVer }`, and
the **tag-name → version convention is documented and pluggable**: the default strips a leading
`v` and takes the substring after the last `@` (covering `v1.2.3`, `pkg@v1.2.3` and
`@scope/pkg@1.2.3` — the three forms `@effected/workspaces`' `ReleaseTag` produces), with an
`extract` override for anything else. Prereleases are excluded unless
`includePrerelease: true`.

**`GitHubRepository`** (new) — `settings → RepoSettings` (the faithful projection silk-sync-action
needs: `nodeId`, `allowAutoMerge`, `squashMergeCommitTitle` and the other thirteen),
`updateSettings(patch)`, `defaultBranch → string`, `nodeId → string`. Three consumers hit
`GET /repos/{owner}/{repo}` for three different subsets (evidence §5.3); one service, three
accessors, no cast.

**`GitHubCommit`** — `get(ref)`, `list(options?)`, `compare(base, head)`, `changedFiles(ref,
options?)`. The documented GitHub constraint stays documented: `GET .../commits/{ref}` paginates
**by file** (300/page) while `compare` paginates **by commit**, so a one-commit compare is
permanently truncated at 300 files. `changedFiles` keeps the file-counting paginator, now with
caller-controllable `PageOptions`.

**`GitHubContent`** — `getFile(path, options?) → string`. Keeps all three current guards, which are
correct and hard-won: reject a directory listing, reject a non-`file` type, and **reject any
encoding other than `base64`** — an over-size file comes back as `encoding: "none"` and decoding it
as base64 yields silent garbage. Adds `getFileOption` returning `Option.none` on 404, because
"absent" is not an error for a config-file read.

**`GitHubIssue`** — `list(options?)`, `get(n)`, `close(n, reason?)`, `comment(n, body)`,
`linkedIssues(prNumber, options?)` and `isCrossReferencedBy(issueNumber, prNumber)`. The last two
are typed GraphQL — see [GraphQL ownership](#graphql-ownership).

**`GitHubRelease`** — `create(input)`, `getByTag(tag)`, `getByTagOption(tag)`, `list(options?)`,
`update(id, patch)`, `uploadAsset(id, asset)`, `listAssets(id, options?)`. `listAssets` now
forwards `PageOptions` (it did not). `uploadAsset` uses the typed route with
`baseUrl: "https://uploads.github.com"` and a `content-type` header — both expressible through
`Rest.RequestExtras`, which is exactly why those three fields survived the narrowing.

**`PullRequest`** — `get(n)`, `list(options?)`, `listFiles(n, options?)`,
**`listAssociatedWithCommit(sha, options?)`**, `create(input)`, `update(n, patch)`,
**`upsert(input) → { pullRequest, created }`**, `merge(n, options?)`, `addLabels(n, labels)`,
`requestReviewers(n, reviewers)`, `setAutoMerge(n, method | "off")`. Four changes:
`listAssociatedWithCommit` paginates (it did not) and is named so silk-router-action can find it;
`getOrCreate` becomes `upsert` for consistency with `GitBranch`/`GitTag`; `PullRequestListOptions`'
`paginate?: boolean` — a boolean switching between two different code paths — is deleted in favor
of `PageOptions`; and auto-merge becomes an explicit method rather than an option that fires
GraphQL mutations from an `Effect.tap` after create/update, which is how a `PullRequestError{operation:"autoMerge"}`
could surface from a call that had already succeeded. `PullRequestInfo`'s optional fields
(`mergedAt`, `body`, `mergeCommitSha`, `baseSha`) are **re-examined at implementation**: they are
optional today because hand-written test doubles did not set them, which is a fixture problem, not
a domain one.

**`PullRequestComment`** — `create(pr, body)`, `upsert(pr, marker, body)`, `find(pr, marker) →
Option<CommentRecord>`, `delete(pr, id)`. `find` **paginates**. The hardcoded
`<!-- savvy-web:${key} -->` marker becomes a pure class:

```ts
export class CommentMarker extends Schema.Class<CommentMarker>("CommentMarker")({
  namespace: Schema.NonEmptyString, key: Schema.NonEmptyString,
}) {
  get html(): string;   // `<!-- ${namespace}:${key} -->`
  matches(body: string): boolean;
}
```

No vendor branding in a library, no layer parameter, and the marker is testable without a client.

**`CheckRun`** — `create(name, headSha)`, `get(id)`, `update(id, output)`, `complete(id,
conclusion, output?)`, `withCheckRun(name, headSha, use)`. Two fixes. First, `withCheckRun`'s
callback is `R`-less today, forcing consumers to build self-contained layers; it becomes
`<A, E, R>(use: (id) => Effect<A, E, R>) => Effect<A, E | GitHubError, R>`. Second, **byte
budgeting**:

```ts
export class CheckRunOutput extends Schema.Class<CheckRunOutput>("CheckRunOutput")({
  title: Schema.String, summary: Schema.String,
  text: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(Schema.Array(Annotation)),
}) {
  /** GitHub's cap: 65535 **UTF-8 bytes**, not characters. */
  static readonly SUMMARY_LIMIT_BYTES = 65535;
  /** Truncate summary and text to the byte budget; slice annotations to 50. */
  truncated(): CheckRunOutput;
}
```

The old library sliced annotations to 50 and did nothing about the summary, so silk-release-action
wrote `capCheckSummary` (`create-validation-check.ts:18-37`) with a comment recording the real
failure: GitHub rejects with *"summary exceeds a maximum bytesize of 65535"*, and `✅/❌/🦋/│` cost
several bytes each, so a character-count check passes while the request 422s. That logic moves here
and is **hardened while moving**: the consumer's version strips one trailing U+FFFD after slicing
the byte buffer, but a split 4-byte codepoint can produce more than one, so the port trims
replacement characters until the tail is clean (and the property test asserts the result is valid
UTF-8 within budget for arbitrary input). `truncated()` is a pure method on the value class, so
this is testable with no client at all.

**`WorkflowDispatch`** — `dispatch(workflow, ref, inputs?)`, `runStatus(runId)`,
`dispatchAndWait(workflow, ref, options?)`. The poll loop keeps its shape but loses the
**sentinel error**: today "not done yet" is encoded as
`WorkflowDispatchError{operation: "poll-pending"}`, a control-flow value baked into a user-visible
error union. Here the loop is `Effect.repeat` with a `while` predicate over the *success* value
(`Schedule.spaced(interval)` bounded by `times`), and a genuine timeout fails as
`GitHubError { kind: "rejected", operation: "WorkflowDispatch.dispatchAndWait" }`. The generic
poll-until-a-domain-predicate combinator this is an instance of belongs to
`@effected/github-actions` (Phase 3); this method is the domain-specific one and stays.

**`TokenPermissions`** (was `TokenPermissionChecker`) — **not a service.** Its Live was
`Layer.succeed` with zero octokit and zero `R` — a pure ordinal comparator
(`read < write < admin`) over a `Record<string, string>` the caller already holds
(`layers/TokenPermissionCheckerLive.ts:11-57,80-125`). It becomes a pure class:

```ts
export class TokenPermissions extends Schema.Class<TokenPermissions>("TokenPermissions")({
  granted: Schema.Record(Schema.String, PermissionLevel),
}) {
  compare(required: PermissionRequirement): PermissionResult;
  /** `Effect<void, TokenPermissionError>` — the only Effect on the class. */
  assertSufficient(required: PermissionRequirement): Effect.Effect<void, TokenPermissionError>;
  assertExact(required: PermissionRequirement): Effect.Effect<void, TokenPermissionError>;
}
```

This is the [pure-core / effectful-edge](../../../plans/2026-07-25-github-split-decisions-log.md)
question the templates round flagged as the highest-leverage design question and no skill asks:
*is any of this pure, and can it be tested without a layer?* Here the answer was yes and the old
design had wrapped it in a service anyway — which is also why its test double was the heaviest of
the 38, reimplementing the entire ranking (spec §6). One service, one whole-behavior double and a
parameterized layer factory all disappear. `warnOverPermissioned` — which despite its name did not
warn — is deleted; `compare(...)` returns the extras and the caller logs.

**`Attestation`** — `upload(input) → AttestationRecord`, `listForSubject(digest, options?) →
ReadonlyArray<AttestationListEntry>`. The REST half of the old `Attest` knot, split out per program
decision 5, so that signing/SBOM go to `@effected/sbom` and the mint-sign-build-attest pipeline is
consumer composition. Two behaviors ported deliberately: the pinned
`X-GitHub-Api-Version: 2026-03-10` (the legacy inline-`bundle` shape is deprecated with Sunset
2028-03-10) — which is why this surface uses **`requestDecoded` with an owned Schema** rather than
the OpenAPI-generated response type; and **404 and 422 both mean "no attestations"**, degraded to
an empty list. The `isOctokitLike` runtime guard that **threw a plain `Error`** when the client was
not octokit-backed (`layers/AttestLive.ts:48-52`) — the knot that made `AttestTestFullLayer`
necessary — has no successor: with a typed client there is nothing to sniff.

**`ArtifactMetadata`** — `createStorageRecord(input) → ReadonlyArray<number>`. Worth keeping as a
module for its projection (`storage_records[].id`) even though the route
(`POST /orgs/{org}/artifacts/metadata/storage-record`) turns out to be **in** the current OpenAPI
schema, so the old defensive `OctokitRequest` cast and string-body tolerance are unnecessary.

## GraphQL ownership

The old package owned **two** documents and left the rest in consumers, where three repos wrote
five more. GraphQL becomes typed and owned:

```ts
// src/GraphQL.ts
export class GraphQLDocument<A, V> extends Schema.Class<...> {
  readonly name: string;        // names the span and the error's `operation`
  readonly document: string;
  readonly response: Schema.Codec<A, unknown>;
  readonly variables: Schema.Codec<V, unknown>;
}
```

`client.graphql(document, variables)` encodes the variables, posts the document, and **decodes the
response through the Schema** — so a GraphQL result is a domain value, not an `unknown` the caller
casts. A decode failure is `GitHubGraphQLError { kind: "decode" }` with the `SchemaError` on
`cause`. The `GitHubGraphQL` service disappears: it was a pure error-shaping wrapper that
`JSON.parse`d the client error's `reason` looking for an `errors[]` array
(`layers/GitHubGraphQLLive.ts:7-20`) — with a typed error carrying `errors` structurally, there is
nothing left for it to do.

| Document | Home today | Owner after the split |
| --- | --- | --- |
| `closingIssuesReferences` | `GitHubIssueLive.ts:40-48` **and** silk-release-action `:227-240` | **github** — the consumer's dual-alias version is a strict superset (`userLinkedOnly`, plus `id/state/url`), so the library's version is replaced by it and `GitHubIssue.linkedIssues(pr, { userLinkedOnly })` covers both |
| issue timeline `CROSS_REFERENCED_EVENT` | silk-release-action `:453-471` | **github** — `GitHubIssue.isCrossReferencedBy(issue, pr)`, an idempotence guard, which is the only thing the consumer projected out of it |
| `addComment` by node id | silk-release-action `:489-498` | **dropped** — `GitHubIssue.comment(number, body)` over REST does the same thing; the consumer used GraphQL only because it happened to hold a node id |
| `createLinkedBranch` | silk-release-action `:78-84` | **github — no REST equivalent exists.** `GitBranch.createLinked({ issueNodeId, name, oid })` |
| `createPullRequest` | silk-release-action `:86-98` | **dropped** — `PullRequest.create` covers it; the consumer wanted the PR node id back, which `PullRequestInfo.nodeId` already carries |
| `enable/disablePullRequestAutoMerge` | `utils/AutoMerge.ts:6-21` | **github** — behind `PullRequest.setAutoMerge`; the exported `AutoMerge` namespace, a second way to do what the `autoMerge` option did, is deleted |
| `RESOLVE_PROJECT_QUERY` (ProjectV2) | silk-sync-action `src/sync/projects.ts` | **consumer** — ProjectV2 is silk-sync-action's domain, not the kit's. It keeps the document and constructs its own `GraphQLDocument`, gaining typed variables, a decoded response, and `kind: "alreadyExists"` in place of the `text.includes("already")` sniff at `:34-37` |

That last row is the shared-vocabulary judgment (program decision 9) applied to GraphQL:
`GraphQLDocument` is the **mechanism**, owned here; a ProjectV2 schema is **content**, owned by the
one consumer that has it. Pulling it in would make the kit carry a domain no other consumer touches.

## Actions decoupling

Three places where Actions-runtime knowledge leaks into today's GitHub layer (evidence appendix),
and what replaces each:

| Leak | Today | Here |
| --- | --- | --- |
| `silentOctokitLog` reroutes octokit's request log into a `::debug::` workflow command | `GitHubClientLive.ts:43-56,172` | octokit's log is silenced (`plugin-request-log` is gone with `@octokit/rest`), and **the client logs its own retries** with `Effect.logDebug`. `github-actions` maps Effect logs to workflow commands through a `Logger` — the correct seam, and one that works for every kit package |
| `process.env.GITHUB_REPOSITORY` | `GitHubClientLive.ts:294`, `GitHubAppLive.ts:85` | [`Repo`](#the-repo-coordinate); the env-driven variant is `Repo.layerFromConfig()`, named for what it does |
| `process.env.GITHUB_TOKEN` | `GitHubClientLive.ts:339` | `GitHubClient.layerFromConfig()` over `Config.redacted` |

Plus: **no token masking** in this package (github-actions calls `setSecret`), **no `ActionState`
persistence** (github-actions owns it; `InstallationToken` is merely encodable), and **no
`WorkflowCommand`** import of any kind. After this, the package reads no environment variable
except through a `Config` in a layer variant that is named for being env-driven, and it is
otherwise runnable anywhere — which is what makes it testable and what makes a non-Actions consumer
possible.

## Shared vocabulary

Per program decision 9, recorded per concept rather than defaulted:

- **`SemVer` — one canonical model, edge taken.** `@effected/semver` is pure tier, so the
  `workspace:~` edge is free under R3, and `GitTag.latestSemver` returning a real `SemVer` is what
  lets a consumer compare without re-parsing. The alternative (return strings and let consumers
  sort) is what produced the 35-line loop.
- **`RepoRef`, `PullRequestInfo`, `InstallationToken`, `CheckRunOutput`, `ReleaseData` — canonical
  here.** `github-actions` depends on `github` (program decision 4), so it consumes these rather
  than duplicating; duplicating a load-bearing model that must interoperate across the two packages
  is the failure mode decision 9 warns about.
- **A digest is a small deliberate duplication.** `Attestation` needs a sha256 subject digest;
  `@effected/lockfiles` owns `IntegrityHash` for package tarballs. These are different concepts
  wearing similar clothes (a lockfile integrity string is `sha512-<base64>`; an attestation subject
  is `sha256:<hex>`), and taking a lockfiles edge to share a branded string would drag a package
  across a seam for a 15-line type. `github` declares its own branded `Sha256Digest`.
- **`ReleaseTag` stays in `@effected/workspaces`.** `GitTag.latestSemver`'s default name→version
  extraction covers the same three formats but is a *parsing convention*, not the tag-format
  authority; a consumer that needs to *produce* tags uses `ReleaseTag`. If a third consumer needs
  both directions in one place, inverting a contract (github declares, workspaces implements) is
  the recorded escalation — not an edge from github to an integrated package.

## Testing

`@effect/vitest`, `it.effect` as the default, `assert.*` — never `expect`; tests in `__test__/`.

- **Every service ships `makeTest(overrides?: Partial<Shape>)` + `layerTest(overrides?)`**, copying
  `@effected/workspaces` (`WorkspaceDiscovery.ts:520,589`). Unstubbed members `Effect.die` with a
  message naming the member and telling the caller to pass an override — the same shape as
  `WorkspaceDiscovery.makeTest`'s `info()`. This deletes, in one move, silk-router-action's seven
  `Stream.die("paginateStream not used")` stubs and the six whole-service `Layer.succeed`
  reimplementations in consumer tests (evidence §4.4).
- **`GitHubClient.layerFixture(routes)` is the one recorded-response double, and it is not a
  reimplementation.** The §5.6 finding is that the shipped double ignored `perPage`/`maxPages`, so
  truncation was structurally untestable, and never invoked the callback, so "did the caller ask for
  page N?" was unanswerable. The fix is that the fixture double **pages recorded arrays through the
  same `internal/paginate.ts` engine the Live layer uses** — it cannot drift, because there is one
  implementation — and records the page requests it issued so a test can assert them. This is the
  narrow exception to the behavior-reimplementing-double ban, and it is safe precisely because it
  reimplements nothing.
- **Unit coverage carries the classification boundary** — the `GitHubError.fromOctokit` matrix
  across every `kind`, the 404-degrades-to-`false`/`Option.none` family, the `alreadyExists` →
  `upsert` recovery on both the branch and tag paths (including the raced case where the second
  call also fails), and the retry schedule's three arms (server-advised delay, jittered backoff,
  refuse-and-fail past `maxServerAdvisedDelay`) driven by `TestClock`.
- **Pure classes get pure tests, with no layer at all**: `TokenPermissions` (the whole
  read<write<admin matrix), `CheckRunOutput.truncated()`, `CommentMarker`, `RepoRef.parseResult`,
  `BotIdentity`, `RetryPolicy.schedule()`.
- **Property test on the byte budget.** `it.effect.prop` over arbitrary strings including
  multi-byte and 4-byte codepoints: `truncated()` output is always valid UTF-8, always within
  65535 bytes, and always ends with the truncation notice when truncation happened. This is the one
  invariant where a counterexample is a production 422, so it gets a property rather than examples.
- **A pagination-forwarding test per paginating method**: drive it through the fixture double and
  assert the issued page requests honor `perPage`/`maxPages`. This is what makes "no method passes
  `{}`" a checked property rather than a review item.
- **Bundle-reachability test.** After `pnpm build --filter @effected/github`, bundle a program that
  imports only `GitHubClient` and assert `universal-github-app-jwt` is **absent** from the module
  graph; then bundle one importing `GitHubApp` and assert it is present (the control — without it,
  the first assertion could pass for the wrong reason). The tree-shakability invariant is described
  as *measured*; this is where it gets measured.
- **Integration (`@effect/platform-node`, devDependency), opt-in on a token**: a real
  `GET /rate_limit` round trip pinning the header parse, and a real paginated read pinning the
  iterator adapter. Skipped without credentials, never silently green.
- **Mutate-the-edges before declaring green**: flip the `maxPages` bound, the byte budget, the
  `alreadyExists` classification and the retry `while` predicate, and confirm the suite goes red.

No `./testing` subpath. None of the 20 behavior-reimplementing doubles is ported.

## Observability

Per the [observability standards](../effect-standards.md#observability-standards) — named spans,
telemetry-agnostic, no SDK construction.

- Every public fallible boundary is an `Effect.fn`: `Effect.fn("GitHubClient.request")`,
  `Effect.fn("GitBranch.upsert")`, `Effect.fn("GitTag.latestSemver")`.
- Span attributes are **stable identifiers only**: the route, `owner`/`repo`, the resulting HTTP
  status, the page count for a paginated call, the `kind` on failure. **Never a token, never a
  private key, never a request or response body, never GraphQL variables** — variables routinely
  carry node ids and PR bodies.
- **Retries log, at debug.** One `Effect.logDebug` per retry with `{ route, attempt, delayMillis,
  kind }`. This is the replacement for `silentOctokitLog`'s `::debug::` reroute and it is the only
  logging in the package; consumers log at their own operation boundaries.
- **No metrics in v1.** The old package incremented a `githubApiCalls` counter tagged by
  `operation` and a `rateLimitHits` counter; `@effected/git` sets the house precedent of spans with
  no metrics, and a library should not decide cardinality for the consumer paying the bill. The
  spans are there to derive counters from.

Build: `savvy.build.ts` carries the narrow `_base` suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized bases of every
`Schema.Class` / `TaggedClass` / `TaggedErrorClass` / `Context.Service`; never widen it. **Watch
item for the build gate:** `Rest.Params<R>` and friends name `@octokit/types` symbols in `@public`
signatures. Those are external declared-dependency types, which API Extractor resolves as externals
rather than forgotten exports — but this is the first kit package to surface a third-party generic
type across its public API, so the first `pnpm build --filter @effected/github` is where that gets
confirmed. Gate on the filtered build, never the raw script.

## Deliberately not ported

Each line is something the old package shipped and a reviewer might ask after.

- **`RateLimitState`.** A service whose shape *is* a `Ref` — unmockable by construction, coupled by
  `Effect.serviceOption` so forgetting it degrades silently, never exported so a consumer could not
  seed it anyway, and used by nothing in production. Replaced by one Effect-valued member on the
  client.
- **`RateLimiter`.** Zero production consumers across six repos. `checkRest`/`checkGraphQL` are
  `client.request("GET /rate_limit", {})` and `client.rateLimit`; `withRateLimit`'s sleep-or-fail
  gate is covered by the reactive `kind: "rateLimited"` path; `withRetry` (which retried
  *everything*, including permission denials, for want of a `while` predicate) is deleted outright.
- **`resilienceSchedule`** and **`GitBranchLive.retryOnTransient`** — the second and third of four
  retry policies. One policy, in the client.
- **`OctokitAuthApp`.** A `Context.Service` wrapping one function, with an `as unknown as AppAuth`
  erasing every real overload, no test double, and a non-effectful shape. Gone with
  `@octokit/auth-app`.
- **`GitHubGraphQL`.** A pure error-shaping wrapper that `JSON.parse`d another error's `reason`
  string. Folded into `client.graphql` + a structurally typed `GitHubGraphQLError`.
- **`TokenPermissionChecker` as a service** — a pure comparator behind a `Layer.succeed` and a
  parameterized layer factory. Now a pure class.
- **The `AutoMerge` namespace** — a second, exported way to do what `PullRequest`'s `autoMerge`
  option did.
- **`observedAt` on the rate-limit snapshot** — written on every snapshot, read by nothing,
  documented as "reserved for a future staleness gate".
- **`operation: string` on `client.rest`** — a free-form telemetry key unrelated to the endpoint,
  which one consumer filled with the invented `"pulls.list.validation"`.
- **The `./testing` subpath** — two lines re-exporting the entire main entry, conveying no
  boundary, and the route by which consumers pulled `SbomLive` into a test file.
- **The 20 behavior-reimplementing doubles**, and the five that were already dead.
- **`<!-- savvy-web:${key} -->`** and the `"github-action-effects/…"` service-id prefix — vendor
  branding inside a library. Ids become `"@effected/github/<Name>"`.

## Decisions recorded

1. **`@octokit/core` + `plugin-paginate-rest`, not `@octokit/rest`.** Route-keyed typing comes from
   `@octokit/types`' generated `Endpoints`, which `@octokit/core`'s `request` already consumes; the
   rest wrapper adds `plugin-request-log` (immediately neutralized today) and 1.4 MB of duplicate
   endpoint types. Supersedes the evidence pack's `RestEndpointMethodTypes` suggestion, which was
   right about the shape and one package too high.
2. **`universal-github-app-jwt`, not `@octokit/auth-app`.** Same JWT engine, ~492 KB of OAuth
   app/user/device-flow machinery left behind, and the installation-token endpoints go through the
   client we already have — which also drops `HttpClient` from the App path's `R` and deletes a
   hand-rolled `Link: rel="next"` pager. Constraint inherited unchanged: PKCS#1 keys convert only
   under the Node export condition.
3. **`GitHubApp.clientLayer` — a `layer`-family static on the module that owns the dependency,**
   not `GitHubClient.layerFromApp` on the module that declares the service. Statics cannot cross
   modules and heavy dependencies must not; the `Workspaces.localExecLayer` precedent already
   establishes the shape.
4. **`layerFromEnv` → `layerFromConfig`,** reading through `ConfigProvider` with `ConfigError` as
   the honest construction failure. Answers the spec's "should construction fail at all?" with
   *yes, but with the right error* — which is what dissolves silk-router-action's `Layer.orDie`
   plus five-line comment.
5. **One `GitHubError` for every resource, not eighteen.** Consumers `catchTag` a resource-specific
   error exactly once in six repos, and that site disappears with `upsert`. `kind` + `operation`
   carry everything the census shows being read.
6. **`retryable` is derived; `retryAfterMillis` stays as an optional field** because the retry
   schedule reads it off the error via `Schedule.fromStepWithMetadata`'s `input`.
7. **One retry policy, inside the client, driven by GitHub's headers.** Four policies become one;
   proactive throttling is not shipped, because the feature that would have needed it had zero
   users and the reactive path handles the case correctly.
8. **`Repo` is a value-only `Context.Service`** — a recorded exception to "no non-effectful members
   on a service shape", valid only while the shape is entirely one immutable value with no methods.
9. **`TokenPermissionChecker` becomes a pure class.** Its Live was `Layer.succeed` with zero
   octokit and zero `R`; the service wrapper bought nothing and cost the heaviest test double in
   the package.
10. **The fixture client double shares the Live pagination engine.** The single narrow exception to
    the no-behavior-reimplementing-doubles ban, safe because it reimplements nothing.
11. **No dependency edge to `@effected/commands`' `Retry`.** Different error type, different
    transport; the shared thing is a convention worth writing down in `effect-standards.md`, not a
    package edge.
12. **ProjectV2 stays with silk-sync-action.** `GraphQLDocument` is the mechanism and is owned here;
    a ProjectV2 schema is content and belongs to the one consumer that has it.

## As built — where implementation corrected the design

Recorded 2026-07-25, after the package was implemented and tested. Everything
else in this document describes what shipped; these six are the places building
it produced a different answer than designing it did.

1. **`Repo` is resolved per call, not once at layer construction.** The design
   said resource layers resolve `GitHubClient | Repo` at construction, giving
   each method `R = never`. Built that way, **`Repo.provide(other)` silently does
   nothing** — the resource already holds the repository it was built with, so
   the multi-repository story would have been decorative. A test caught it. The
   client stays resolved at construction; `Repo` is read per call and appears in
   every resource method's `R`, which costs one context read and makes the
   scoped override real. The general rule this refines: **resolve a dependency
   once when it is stable, per call when varying it is the point.**
2. **Pagination is built on octokit's own iterator, not a hand-rolled Link
   walk.** Reading the plugin's source settled two things the design could not:
   its `next()` advances the cursor **only on success**, so wrapping it in the
   retry re-requests a failed page rather than skipping it; and it carries three
   behaviors we would otherwise have reimplemented — the compare endpoint's
   `total_commits` continuation, the search-shaped `{ total_count, items }`
   normalization, and the 409-on-empty-repository case. `maxPages` and header
   capture stay on our side.
3. **`GitHubCommit.changedFiles` builds a custom `PageSource`.** Its route is not
   in `PaginatingEndpoints` — the payload is a commit object, not an array — even
   though it pages **by file** at 300 per page. It therefore constructs pages
   from `client.request` with `page`/`per_page` and hands them to the same
   `internal/paginate` engine, which is exactly what that seam is for. There is
   still one pagination implementation.
4. **`GitHubError` lives in its own module**, not in `GitHubClient.ts`, because
   the retry policy needs the error's shape and the client needs the policy.
   `Resilience` ended up importing **no** error class at all: it declares a
   structural `RetryableFailure { retryable, retryAfterMillis? }`, so one policy
   serves both the REST and the GraphQL error and every policy decision is
   testable against a two-field literal.
5. **Two routes are not in the generated map**, and both use `requestDecoded`
   with an owned schema: release-asset upload (`POST …/releases/{id}/assets`,
   omitted by octokit's generator because it takes a raw binary body on
   `uploads.github.com`) and the attestation reads (pinned
   `X-GitHub-Api-Version`, so the live contract differs from the description).
6. **`withCheckRun` concludes on *every* exit, and `use` can override the verdict.** The bracket shipped as `Effect.gen` plus `.pipe(Effect.tap, Effect.tapError)`, and those two fire on success and on a *typed* failure only: an interrupted `use` — a cancelled workflow, a job timeout, a losing branch of a race — and a **defect** both left the check run `in_progress` forever. GitHub never reaps such a run, so it blocks branch protection until a human deletes it by hand. Found during the Phase 7 plugin-authoring pass, writing the skill that documents this surface: the bracket *shape* invites the assumption that it behaves like `acquireUseRelease`, and nothing in the type signature said otherwise. The fix is `Effect.onExit` with an exit-aware finalizer (`concludeFor`, `src/CheckRun.ts:301-311`), which runs its finalizer **uninterruptibly** — core's `onExitPrimitive` clears `fiber.interruptible` unless told otherwise (`.repos/effect/packages/effect/src/internal/effect.ts:3957-3962`) — and that is what lets the concluding `PATCH` survive the very interrupt that triggered it. The defaults are `"success"` on success, `"failure"` on a typed failure *or a defect*, and `"cancelled"` on an interrupt only, via `Cause.hasInterruptsOnly` (`src/CheckRun.ts:265-280`). Only the success path keeps the error channel: failing to record a success is a real failure the caller should see, whereas on the other paths the completing call is ignored, because neither an interrupt nor an existing failure should be replaced by whatever went wrong while reporting it — which makes that the **exit's** choice rather than the verdict's (`src/CheckRun.ts:310`).

   The second half is that the other four conclusions were unreachable: `"neutral"`, `"timed_out"`, `"action_required"` and `"skipped"` could only be produced by dropping to a raw `create`/`complete` pair. The motivating case is real and was in the predecessor plugin's own guidance — a **findings-derived** verdict, where `"neutral"` means "ran, advisory output, does not block branch protection" and a `strict-warnings` input escalates it to `"failure"`. The work computes the verdict; the bracket has to be able to carry it. So `use` now receives a second parameter, `conclude: ConcludeCheckRun` (`src/CheckRun.ts:133-136` and `:192-196`), rather than returning an outcome value the bracket maps. Two reasons decided that. An outcome return **entangles the verdict with `A`**: the real consumer (silk-release-action's `src/utils/create-validation-check.ts`) concludes with a computed *output* — a title plus a rendered summary table — as well as a literal, so the returned outcome would have to be `{ conclusion, output, value }`, which is a handle's arguments forced through the return type and made mandatory for every caller, including the ones that just want their own value back. And a return value only exists on the **success** path, so the failure and interrupt paths would still have needed a separate mechanism. Passing `conclude` as the *second* parameter (the id stays first) is additive: existing `(id) => …` callbacks still compile.

   **Recording, not sending.** `conclude` stores the verdict in a `Ref`, and the finalizer writes it exactly once, on whichever path `use` leaves by (`src/CheckRun.ts:382-388`). That is what makes an explicit conclusion survive a later failure or an interrupt, keeps the completion a single request no matter how many times `conclude` is called (**last verdict wins**), and lets its error channel be `never` — a caller that could observe a failed `complete` there would have to decide what to do about it while already on the way out. **A recorded verdict wins on every exit path**, failure and interruption included, because how the *check* ran and how the surrounding *program* ended are different questions and only `use` knows the first: a findings-derived `"neutral"` must not be overwritten by `"cancelled"` just because the job was torn down afterwards. Pinned by nine tests in `__test__/resources2.test.ts:99-305`, with two discriminating mutants — reverting to the `tap` form fails the interruption and defect tests (`:132`, `:286`) while leaving the success and typed-failure tests green, and restricting the recorded verdict to the success path fails exactly the two precedence tests (`:214`, `:238`).

Three smaller facts the build and the generated types taught us, all now
comments at their sites: a `static readonly layer` must wrap its factory in an
arrow or throw `Cannot access 'make' before initialization` at import time with
a clean typecheck; a commit's `author` can be `Record<string, never>` rather
than `null`; and the artifact-metadata endpoint has **no `version` field**,
which the previous package sent.

### The API Extractor watch item, answered

Naming third-party generic types (`Endpoints[R]["parameters"]`) on a `@public`
signature is **fine**: API Extractor resolves a declared dependency's types as
externals and emits real imports in the `.d.ts`. No suppression, no inlining.
The build's only `ae-forgotten-export`s are the synthesized `_base` symbols, all
in the suppressed bucket.

Three `{@link}` rules the build enforced, worth knowing before writing TSDoc
here: a link resolves only to symbols **the entry point exports**, under **the
name it exports them by** (a renamed export breaks the module-local spelling); a
schema-declared `Schema.Class` field is not a linkable member (use backticks);
and a module-local `const` is not linkable at all.

## Open questions

Three, and only these — everything else above is a ruling with its reasoning attached.

1. **Does `Attestation` belong in `@effected/github` at all, or does the whole attestation surface
   move to `@effected/sbom` in Phase 4?** Program decision 5 splits it three ways and puts the REST
   surface here, which this design follows. The tension is that the attestation routes need a
   **pinned preview api-version** and an owned response Schema (`requestDecoded`), so they are the
   one resource whose contract is not the OpenAPI's — and Phase 4 will own the bundle format they
   carry. Keeping them here means `sbom` takes a `github` edge for the upload; moving them means
   `github` has no attestation surface and Phase 4 owns an octokit call. **Recommendation: keep as
   designed**, revisit at the Phase 4 checkpoint when the bundle shape is concrete. Flagged because
   it is cheaper to move before implementation than after.
2. ~~**Should `PullRequestInfo`'s four optional fields become required?**~~ **CLOSED** as
   recommended: `mergedAt` is `Schema.Option(Schema.DateTimeUtcFromString)` — whether a pull request
   has merged is a fact GitHub always reports, so an optional key would model a gap in our fixtures
   rather than one in the domain — and `body`, `mergeCommitSha` and the rest stay `optionalKey`.
   Implementation note: the projection **constructs** the `Option` rather than decoding it, because
   the Type side is `Option<DateTime.Utc>` while GitHub's wire form is a nullable ISO string, and a
   codec bridging them would describe GitHub's encoding as if it were ours.
3. **Is `GitHubApp.clientLayer` the right name?** It is a `layer`-family static producing a
   *different* service's layer, and the alternatives each cost something: `GitHubApp.layerClient`
   (matches the `layerFromX` prefix convention but reads as "a layer of clients"),
   `GitHubApp.gitHubClientLayer` (matches `Workspaces.localExecLayer` exactly, but is a mouthful),
   or re-exporting a bound const from `index.ts` (which reintroduces exactly the cross-module reach
   the split exists to prevent). **Recommendation: `clientLayer`.** Naming is cheap to change
   before implementation and expensive after, so it is worth a nod.
