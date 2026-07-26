---
name: github-api
description: Use when calling GitHub's REST or GraphQL API from Effect v4 code through @effected/github — typing a client.request call by route, choosing paginate vs paginateStream, reaching for requestDecoded as an escape hatch, building a GitBranch/GitTag upsert, classifying or catching a GitHubError, wiring a resource service's layer, or working with Repo, RetryPolicy, GraphQLDocument, TokenPermissions, CheckRunOutput, or CommentMarker. Does not cover GitHub App authentication or client construction (github-app-tokens), check-run/PR-comment reporting workflows (actions-reporting), the octokit test harness (testing-actions), or attestation upload (supply-chain-attestation).
---

# `@effected/github`: calling GitHub from Effect v4

Typed GitHub REST and GraphQL over `@octokit/core`'s request surface, plus the
resource services (`GitBranch`, `PullRequest`, `GitHubIssue`, …) that turn raw
endpoints into domain operations. This skill is routing and patterns; the
per-resource member catalogue is
[`references/resources.md`](references/resources.md) — **load it** whenever
the task is "which method reads/writes X".

General Effect v4 rules — service shapes, layer composition, memoization,
`Schema.Class`, testing idioms — live in `effect-v4-services-layers`,
`effect-v4-schema`, `effect-v4-idioms`, `effect-v4-testing`. This skill states
only what `@effected/github` does differently or as a worked instance.

## The route is the key

`client.request(route, params)` types both `params` and the returned `data`
from the route literal alone — no `operation: string`, no callback, no type
parameter to invent, no cast (`packages/github/src/GitHubClient.ts:44-47`):

```ts
import { GitHubClient } from "@effected/github";
import { Effect } from "effect";

const defaultBranch = Effect.gen(function* () {
 const client = yield* GitHubClient;
 const repo = yield* client.request("GET /repos/{owner}/{repo}", { owner: "o", repo: "r" });
 return repo.default_branch; // string — no cast, no hand-written interface
});
```

This replaced `rest<T>(operation: string, fn: (octokit: any) => Promise<{ data: T }>)`,
which cost four consumer repos sixteen cast sites and three hand-written
octokit interfaces (one gave up and typed its methods as
`Record<string, (p: unknown) => Promise<{ data: unknown }>>`). The fluency
audit's Case 1 is the worked before/after: mm's `resolveBaseBranch` went from
an 8-line interface plus 11 lines of code to
`return yield* GitHubRepository.defaultBranch;`
(`.claude/design/effected/consumers/fluency-audit.md:141-177`).

`Rest.Params<R>` and `Rest.Data<R>` (`packages/github/src/Rest.ts:52,66`) are
generic over `R extends Rest.Route = keyof Endpoints`, the map
`@octokit/types` generates from GitHub's OpenAPI description
(`Rest.ts:20`). `Params<R>` intersects a **three-field** `RequestExtras`
(`headers`, `mediaType`, `baseUrl`; `Rest.ts:37-44`), never octokit's own
`RequestParameters` — that type carries a `[parameter: string]: unknown`
index signature and would silently accept every typo. The three fields
survived because real call sites need exactly them: `headers` for a release
asset's `content-type` and the attestations API-version pin, `mediaType`
for raw content reads, `baseUrl` for `uploads.github.com`.

`PaginatingRoute` (`Rest.ts:77`) is `keyof PaginatingEndpoints` — handing a
non-paginating route to `client.paginate` is a **compile** error, which the
string-keyed surface this replaces could not express.

## The escape hatch: `requestDecoded`

A route GitHub does not describe in its OpenAPI schema, or one whose live
shape differs from it, goes through `requestDecoded(route, params, schema)`
(`GitHubClient.ts:61-65`). **The schema is mandatory** — this is an escape
hatch from the route table, never from typing; a shape mismatch fails typed
as `kind: "decode"` rather than surfacing as an unchecked value.

Two real call sites, both verified in source, no others:

- `GitHubRelease.uploadAsset` — release-asset upload is not in the generated
  map at all (raw binary body, `uploads.github.com` host):
  `client.requestDecoded("POST /repos/{owner}/{repo}/releases/{release_id}/assets", { owner, repo, release_id, name, data, baseUrl: "https://uploads.github.com", headers: { "content-type": … } }, AssetResponse)`
  (`packages/github/src/GitHubRelease.ts:236-248`).
- `Attestation.upload` / `Attestation.listForSubject` — both pin
  `X-GitHub-Api-Version: 2026-03-10`, so the live contract differs from what
  the generated types describe (`packages/github/src/Attestation.ts:15,113-148`).

## `Repo`: resolved per call, not once at layer construction

Every resource method carries `Repo` in its `R` — no method takes an
`{ owner, repo }` argument (`packages/github/src/Repo.ts:57-90`). `Repo` is a
value-only `Context.Service<Repo, RepoRef>`
(`Repo.ts:91`), a **recorded exception** to "no non-effectful members on a
service shape": its whole shape is one immutable value, so `Layer.mock` has
nothing to degrade and `Layer.succeed` is the correct double. The moment a
method appears on it, it is a service again and the normal rule reapplies.

```ts
import { Repo } from "@effected/github";
import { Effect } from "effect";

declare const syncOne: Effect.Effect<void, never, Repo>;
declare const targets: ReadonlyArray<Repo["Service"]>;

const syncAll = Effect.forEach(targets, (target) => syncOne.pipe(Repo.provide(target)), { concurrency: 4 });
```

`Repo.provide` is `Effect.provideService(effect, Repo, ref)`
(`Repo.ts:116-119`); `Repo.layerFromSlug` / `Repo.layerFromConfig` parse
`"owner/repo"` (`RepoRef.parseResult`, `Repo.ts:36-43`) once at construction,
`Repo.layerFromConfig` reading `GITHUB_REPOSITORY` through the ambient
`ConfigProvider` (`Repo.ts:107-113`).

**This is a corrected design decision, not the original one.** The design
doc's first pass resolved `GitHubClient | Repo` once per resource layer,
giving every method `R = never`. Built that way, `Repo.provide(other)`
**silently did nothing** — the resource already held the repository it was
built with — and a test caught it
(`.claude/design/effected/packages/github.md:1227-1235`). The general rule
this refines, stated in `effect-v4-services-layers`: resolve a dependency
**once** at construction when it is stable (the client always is here — see
every resource's `make(client)` factory); read it **per call** when varying
it is the point. `GitBranch.ts:148-163` states the same rule at the instance
that caught it.

## Pagination: one engine, forwarded budgets

`src/internal/paginate.ts` is the **only** pagination implementation in the
package (`internal/paginate.ts:26-33`) — the live client, the fixture double,
and `GitHubCommit.changedFiles`'s custom `PageSource` (its route pages by
file, 300/page, and is not in `PaginatingEndpoints` at all) all build a
`PageSource` and hand it to the same `paginate` walk
(`GitHubCommit.ts:236-262`). `maxPages` bounds **requests issued**, not items
collected — the walk stops rather than fetching everything and slicing
(`internal/paginate.ts:35-36`).

```ts
export class PageOptions extends Schema.Class<PageOptions>("PageOptions")({
 perPage: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
 maxPages: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
}) { … } // Rest.ts:114-133
```

`perPage` is **validated, not clamped**: GitHub silently caps a page at 100,
so a caller asking for 250 has a bug whose arithmetic is already wrong —
failing typed at the boundary beats discovering it in production. Every
paginating method takes `PageOptions` and forwards it; no method hard-codes
`{}`. `client.paginate` collects (`Stream.runCollect` over
`paginateStream`, `GitHubClient.ts:330-337`); `client.paginateStream` is lazy
in requests, so a downstream `Stream.take` stops the walk rather than
filtering pages already fetched.

`GitTag.list` still filters client-side after fetching — GitHub has no
server-side ref-prefix filter for `GET /repos/{owner}/{repo}/tags`
(`GitTag.ts:188-190`) — which is exactly why `GitTag.latestSemver` exists
rather than leaving callers to list-then-sort themselves (see
[`references/resources.md`](references/resources.md)).

## Resilience: one policy, in the client; resources never retry

`RetryPolicy` (`packages/github/src/Resilience.ts:74`) is wired **once**, in
the client layer's `{ retry?: RetryPolicy | "off" }` option — every resource
inherits it and none carries its own. This replaces four mutually
inconsistent policies the predecessor shipped, one of which had no `while`
predicate and retried permission denials.

```ts
export class RetryPolicy extends Schema.Class<RetryPolicy>("RetryPolicy")({
 maxRetries: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })), // default 4
 baseDelay: Schema.DurationFromMillis, // default 1s
 maxDelay: Schema.DurationFromMillis, // default 30s
 respectRetryAfter: Schema.Boolean, // default true
 maxServerAdvisedDelay: Schema.DurationFromMillis, // default 60s
}) { … } // Resilience.ts:74-91, RetryPolicy.default at :94-100
```

Only `kind ∈ {"transport", "rateLimited"}` retries; everything else fails on
the first attempt (`RetryableFailure.retryable`, `Resilience.ts:50-55`,
consumed by `GitHubError.retryable` and `GitHubGraphQLError.retryable`).
`RetryPolicy.schedule()` is built on **`Schedule.fromStepWithMetadata`**
(the underlying construct `Schedule.modifyDelay`/`Schedule.while` here
compile to, receiving `Metadata<Input>` with the failure that triggered the
retry), which is the v4-native way to make delay a function of the error
rather than only of attempt count (`Resilience.ts:161-170`). A
server-advised delay (`retry-after` / rate-limit reset) wins outright when
`respectRetryAfter` is set — **unless** it exceeds `maxServerAdvisedDelay`,
in which case the error is re-failed rather than slept through: a 45-minute
primary rate-limit window must surface as a failure, not a hang. Otherwise
it is full jitter in `[0, min(baseDelay·2^attempt, maxDelay)]`.

Headers surface as `client.rateLimit: Effect<Option<RateLimitSnapshot>>`
(`GitHubClientShape.rateLimit`, `GitHubClient.ts:106`) — an **Effect-valued
property**, not a getter, which is what keeps `Layer.mock` /
`Partial<Shape>` stubbing meaningful for it like every other member.
**There is no `RateLimiter` service and no proactive throttling — do not
invent one.** The predecessor's `RateLimitState`/`RateLimiter` had zero
production consumers across six surveyed repos and coupled writer and
reader through `Effect.serviceOption`, so forgetting to provide it degraded
the whole feature silently. A caller that wants to pace itself reads
`client.rateLimit` and builds its own gate; the reactive path (a `403`/`429`
classifies as `kind: "rateLimited"` and gets the server-advised delay)
already covers the exhausted-budget case correctly.

## Errors: one `GitHubError`, classified once

`GitHubError` (`GitHubError.ts:51`) replaces eighteen `Data.TaggedError`
classes with `kind` for routing and `operation` for identification:

```ts
export const GitHubErrorKind = Schema.Literals([
 "notFound", "alreadyExists", "rejected", "unauthorized", "rateLimited", "transport", "decode",
]); // GitHubError.ts:17-32
```

Classification happens **once**, in `GitHubError.fromOctokit(operation,
error, nowMillis)` (`GitHubError.ts:136-148`) — nothing else in the package
inspects a status code. `retryable` is a **derived getter** over `kind`, not
a stored field (`:88-90`). The ergonomic statics cover every
hand-construction site:

```ts
GitHubError.notFound(operation, subject); // status 404
GitHubError.alreadyExists(operation, subject); // status 422
GitHubError.rejected(operation, status, reason);
GitHubError.decode(operation, reason, cause?);
GitHubError.hasKind(...kinds); // predicate for Effect.catchIf / Effect.catchTag guards
```

(`GitHubError.ts:93-120,165-168`.) `GitHubGraphQLError` mirrors the same
`kind` vocabulary plus `notFound` and keeps `errors: ReadonlyArray<{message,
type?}>` — the one structured field a surveyed consumer actually read
(`GraphQL.ts:27-56`). `GitHubAppError` (auth) and `TokenPermissionError`
(the pure comparator) are separate classes — see
[`references/resources.md`](references/resources.md) for `TokenPermissionError`
and `github-app-tokens` for `GitHubAppError`.

**Migration caveat, carried forward from the fluency audit's Case 4**: a
consumer that today catches a resource-specific error tag (`GitHubReleaseError`,
`GitBranchError`, …) will catch `GitHubError` after porting — across six
surveyed repos, a resource-specific `_tag` was matched exactly **once**, and
that call site disappears with `GitBranch.upsert`
(`.claude/design/effected/consumers/fluency-audit.md:527-532`).

## `kind: "alreadyExists"` — what makes `upsert` implementable

`GitBranch.upsert` and `GitTag.upsert` are one call in the common case, two
in the raced one:

```ts
const upsert = Effect.fn("GitBranch.upsert")(function* (branch: string, sha: string) {
 const short = yield* rejectEmpty("GitBranch.upsert", branch);
 return yield* create(short, sha).pipe(
  Effect.as<BranchOutcome>("created"),
  Effect.catchIf(GitHubError.hasKind("alreadyExists"), () => Effect.as(reset(short, sha), "reset" as const)),
 );
}); // GitBranch.ts:190-200
```

This is fluency-audit Case 2: a consumer's `getSha` → `exists` → `create` →
(on failure) `exists` again → `reset` dance — up to four round trips, guarded
by a seven-line comment explaining that the old error carried no structured
"already exists" and so a second existence check was the only way to
distinguish "someone else created it" from a real failure — collapses to
`yield* GitBranch.upsert(name, sha)`
(`.claude/design/effected/consumers/fluency-audit.md:237-301`). The recovery
still **resets** rather than inheriting a branch a concurrent creator rooted
elsewhere, which is the semantics the original comment was defending.
`GitTag.upsert` (`GitTag.ts:199-203`) is the same shape for tags. **Prefer
the upsert over catching `alreadyExists` yourself** — it exists so the
*library* doesn't need a second existence check; consumers shouldn't need
one either.

## Layer statics wrap the factory in an arrow

Every resource's `layer` static is `Layer.effect(this, Effect.map(GitHubClient,
(client) => make(client)))` — never `Effect.map(GitHubClient, make)`:

```ts
export class GitBranch extends Context.Service<GitBranch, GitBranchShape>()("@effected/github/GitBranch") {
 static readonly layer: Layer.Layer<GitBranch, never, GitHubClient> = Layer.effect(
  this,
  Effect.map(GitHubClient, (client) => make(client)),
 );
 // …
} // GitBranch.ts:94-107
```

Passing `make` directly throws `Cannot access 'make' before initialization`
**at import time**, with a clean typecheck — the static initializer runs
while the module body is still evaluating, and `make` is declared further
down the file. Wrapping it in an arrow defers the read to when the layer is
*built*. Every resource module in this package (`GitBranch`, `GitTag`,
`GitCommit`, `GitHubCommit`, `GitHubRepository`, `GitHubIssue`,
`GitHubRelease`, `PullRequest`, `PullRequestComment`, `CheckRun`,
`GitHubContent`, `WorkflowDispatch`, `Attestation`, `ArtifactMetadata`)
follows this shape identically. `effect-v4-services-layers` has the general
rule (module-scoped TDZ on a static initializer); this package is fourteen
instances of it.

## GraphQL is a client member, not a separate service

`client.graphql(document, variables)` (`GitHubClient.ts:93-96`) encodes the
variables, posts the document, and decodes the response through the
document's schema — there is no `GitHubGraphQLLive` layer to wire
separately. `GraphQLDocument<A, V>` (`GraphQL.ts:179`) is built curried,
because `A` is inferred from the response schema while `V` is stated
explicitly:

```ts
import { GraphQLDocument } from "@effected/github";
import { Schema } from "effect";

const ViewerLogin = GraphQLDocument.make({
 name: "viewerLogin",
 document: `query { viewer { login } }`,
 response: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) }),
})<{ readonly login: string }>(); // GraphQL.ts:207-222
```

A decode failure never escapes as a raw `SchemaError` — it is normalized to
`GitHubGraphQLError { kind: "decode" }` with the `SchemaError` on `cause`
(`GitHubClient.ts:344-351`). The kit owns the documents its own resources
need (`GitBranch.createLinked`, `GitHubIssue.linkedIssues`,
`PullRequest.setAutoMerge`); a consumer with its own GraphQL domain — a
ProjectV2 schema, say — builds its own `GraphQLDocument` and gets the same
typing and error taxonomy without this package knowing about its schema.

## The confusable pair: `GitCommit` vs `GitHubCommit`

- **`GitCommit`** (`packages/github/src/GitCommit.ts`) is the **Git Database
  API** — trees, commit objects, and `commitFiles` for the
  read-branch/build-tree/create-commit/move-ref sequence. **Not local git**:
  no subprocess, no working tree (`GitBranch.ts:34-36` states the same
  distinction for branches — `@effected/git` is the package that runs git).
- **`GitHubCommit`** (`packages/github/src/GitHubCommit.ts`) is **reading**
  commits as GitHub reports them — `get`, `list`, `compare`, `changedFiles`
  — over the higher-level commits API, not the Git Database API.

`GitCommit.get(sha)` returns a `CommitRef { sha, treeSha, parents }`
projection built specifically so a caller never needs `octokit.request` cast
for a commit's tree sha (`GitCommit.ts:47-65`); `GitHubCommit.get(ref)`
returns a `CommitSummary` (message, author, url) for display purposes. Pick
by what you're doing: writing a commit onto a tree is `GitCommit`; reading
what a commit says is `GitHubCommit`.

## Pure classes need no layer

`TokenPermissions`, `CheckRunOutput`, `CommentMarker`, `BotIdentity`,
`RepoRef`, `RetryPolicy` reach nothing but `effect` and are testable with no
layer:

- `TokenPermissions.fromGitHub(permissions).assertSufficient({ contents:
  "write" })` — a pure `read < write < admin` comparator, not a service; its
  predecessor was a `Context.Service` behind a `Layer.succeed` with zero
  octokit calls, whose test double reimplemented the entire ranking
  (`TokenPermissions.ts:82-173`).
- `CheckRunOutput.truncated()` cuts `summary`/`text` to GitHub's 65535-**byte**
  (not character) cap without leaving a broken UTF-8 code point mid-cut
  (`CheckRun.ts:73-99`).
- `CommentMarker.html` / `.matches(body)` — the hidden marker that makes a
  sticky comment findable, no longer a hardcoded vendor string baked into
  the library (`PullRequestComment.ts:19-34`).
- `RepoRef.parseResult(slug)` is the sync `Result` primitive;
  `RepoRef.parse` is `Effect.fromResult` over it (`Repo.ts:36-46`) — the
  house sync/Effect parity pattern from `building-a-format-package`.

## Testing doubles

Every resource ships `makeTest(overrides?: Partial<Shape>)` +
`layerTest(overrides?)`; every unstubbed member `Effect.die`s naming itself
(`GitBranch.ts:109-119,126-128` is representative of all fourteen).
`GitHubClient.layerFixture(fixtures)` is the **one** recorded-response
double in the package and the single narrow exception to the
no-behavior-reimplementing-doubles rule: it pages a recorded array through
the *same* `internal/paginate.ts` engine the live client uses
(`GitHubClient.ts:267,364-413`), so `perPage`/`maxPages` cannot behave
differently in a test than in production. General testing conventions
(`@effect/vitest`, `it.effect`, `assert.*` never `expect`) are
`effect-v4-testing`'s job, not restated here. The octokit `fetch`-hook test
harness that exercises the **real** client (classification, header capture,
retry, Link-following pagination) against canned HTTP belongs to
`testing-actions`.

## Out of scope — see the named skill

- **GitHub App authentication, token lifecycle, client constructors**
  (`GitHubApp`, `InstallationToken`, `layerFromApp`-equivalents) →
  `github-app-tokens`.
- **Check runs and PR comments as a reporting workflow** (when/how to open a
  check run or post a sticky comment during an Actions run, as opposed to
  the raw `CheckRun`/`PullRequestComment` member catalogue below) →
  `actions-reporting`.
- **The octokit `fetch`-hook test harness** → `testing-actions`.
- **Attestation upload as part of a sign/SBOM pipeline** → `supply-chain-attestation`.

## Reference

- [`references/resources.md`](references/resources.md) — **Load when**
  you need a specific resource service's member list, signature, or return
  type: `GitBranch`, `GitTag`, `GitCommit`, `GitHubCommit`,
  `GitHubRepository`, `GitHubContent`, `GitHubIssue`, `GitHubRelease`,
  `PullRequest`, `PullRequestComment`, `CheckRun`, `WorkflowDispatch`,
  `Attestation`, `ArtifactMetadata`, `TokenPermissions`.
