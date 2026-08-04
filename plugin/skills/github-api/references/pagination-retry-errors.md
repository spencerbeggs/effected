# Pagination, retry and the error taxonomy

Load when: tuning a paginating call's request budget, debugging a retry
sequence, or classifying/catching a `GitHubError` or `GitHubGraphQLError`.
`SKILL.md` states the standards this reference explains the mechanism for.

## Pagination: one engine, forwarded budgets

There is exactly one pagination implementation in `@effected/github` — the
live client, the fixture test double, and `GitHubCommit.changedFiles`'s
custom page source (its route pages by file, 300/page, and isn't in the
generated paginating-route map at all) all build a page source and hand it
to the same walk. `maxPages` bounds **requests issued**, not items
collected — the walk stops rather than fetching everything and slicing.

`PageOptions` has `perPage` (validated between 1 and 100) and `maxPages`
(validated greater than 0). `perPage` is **validated, not clamped**: GitHub
silently caps a page at 100, so a caller asking for 250 has a bug whose
arithmetic is already wrong — failing typed at the boundary beats
discovering it in production. Every paginating method takes `PageOptions`
and forwards it; no method hard-codes `{}`.

`client.paginate` collects everything (`Stream.runCollect` over the same
walk `client.paginateStream` exposes); `client.paginateStream` is lazy in
requests, so a downstream `Stream.take` stops the walk rather than
filtering pages already fetched.

`GitTag.list` still filters client-side after fetching — GitHub has no
server-side ref-prefix filter for that endpoint — which is exactly why
`GitTag.latestSemver` exists rather than leaving callers to list-then-sort
themselves.

## Resilience: one policy, in the client; resources never retry

`RetryPolicy` is wired once, in the client layer's `{ retry?: RetryPolicy |
"off" }` option — every resource inherits it and none carries its own.
Fields: `maxRetries` (0–10, default 4), `baseDelay` (default 1s), `maxDelay`
(default 30s), `respectRetryAfter` (default true), `maxServerAdvisedDelay`
(default 60s).

Only `kind ∈ {"transport", "rateLimited"}` retries; everything else fails on
the first attempt. Both `GitHubError` and `GitHubGraphQLError` satisfy a
small two-field `RetryableFailure` interface (`retryable`,
`retryAfterMillis?`) rather than `RetryPolicy` importing either error class
directly — that seam is what makes every retry decision testable against a
plain two-field literal instead of a constructed error, and what lets the
policy classify a failure without knowing which error type produced it. The
schedule is built to receive the failure that triggered the retry, which is
what lets delay be a function of the error rather than only of attempt
count. A server-advised delay (`retry-after` /
rate-limit reset) wins outright when `respectRetryAfter` is set — unless it
exceeds `maxServerAdvisedDelay`, in which case the error is re-failed rather
than slept through: a 45-minute primary rate-limit window must surface as a
failure, not a hang. Otherwise delay is full jitter in
`[0, min(baseDelay·2^attempt, maxDelay)]`.

`client.rateLimit` is an **effect-valued property**
(`Effect<Option<RateLimitSnapshot>>`), not a getter — that is what keeps
`Layer.mock`/`Partial<Shape>` stubbing meaningful for it like every other
member. There is no `RateLimiter` service and no proactive throttling, and
none should be added — a writer/reader pair coupled through an optional
service degrades the whole feature silently the moment either side forgets
to provide it. A caller that wants to pace itself reads `client.rateLimit`
and builds its own gate; the reactive path (a 403/429 classifies as
`kind: "rateLimited"` and gets the server-advised delay) already covers the
exhausted-budget case correctly.

## Errors: one `GitHubError`, classified once

`GitHubErrorKind` is a closed literal union: `notFound`, `alreadyExists`,
`rejected`, `unauthorized`, `rateLimited`, `transport`, `decode`.
Classification happens once, in `GitHubError.fromOctokit(operation, error,
nowMillis)` — nothing else in the package inspects a status code.
`retryable` is a derived getter over `kind`, not a stored field.

Ergonomic statics cover every hand-construction site: `GitHubError.notFound(operation,
subject)` (status 404), `.alreadyExists(operation, subject)` (status 422),
`.rejected(operation, status, reason)`, `.decode(operation, reason, cause?)`,
`.hasKind(...kinds)` (a predicate for `Effect.catchIf`/`Effect.catchTag`
guards).

`GitHubGraphQLError` mirrors the same `kind` vocabulary plus `notFound` and
keeps `errors: ReadonlyArray<{message, type?}>`. `GitHubAppError` (auth) and
`TokenPermissionError` (the pure comparator) are separate classes — see
`github-app-tokens` for `GitHubAppError` and `resources.md` for
`TokenPermissions`.

**Migration caveat**: a consumer that today catches a resource-specific
error tag will catch `GitHubError` after porting — across a real survey of
consumer repos, a resource-specific tag was matched exactly once, and that
call site disappears entirely once it moves onto `GitBranch.upsert`.

## GraphQL is a client member, not a separate service

`client.graphql(document, variables)` encodes the variables, posts the
document, and decodes the response through the document's schema — there is
no separate GraphQL layer to wire. `GraphQLDocument<A, V>` is built curried,
because `A` is inferred from the response schema while `V` is stated
explicitly:

```ts
import { GraphQLDocument } from "@effected/github";
import { Schema } from "effect";

const ViewerLogin = GraphQLDocument.make({
  name: "viewerLogin",
  document: `query { viewer { login } }`,
  response: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) }),
})<{ readonly login: string }>();
```

A decode failure never escapes as a raw schema error — it is normalized to
`GitHubGraphQLError { kind: "decode" }` with the schema error on `cause`.
The kit owns the documents its own resources need (`GitBranch.createLinked`,
`GitHubIssue.linkedIssues`, `PullRequest.setAutoMerge`); a consumer with its
own GraphQL domain builds its own `GraphQLDocument` and gets the same typing
and error taxonomy without this package knowing about its schema.

## Layer statics wrap the factory in an arrow

Every resource's `layer` static is `Layer.effect(this, Effect.map(GitHubClient,
(client) => make(client)))` — never `Effect.map(GitHubClient, make)` passed
directly. Passing the factory directly throws "Cannot access 'make' before
initialization" **at import time**, with a clean typecheck: the static
initializer runs while the module body is still evaluating, and `make` is
declared further down the file. Wrapping it in an arrow defers the read to
when the layer is *built*. Every resource module in the package follows this
shape identically — treat any new resource that skips the arrow as a defect,
not a style nit.
