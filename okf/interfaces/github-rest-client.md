---
type: Interface
title: "@effected/github REST client"
description: The route-keyed REST client, its escape hatch, and the pagination model over octokit.
status: stable
kind: api
resource: ../../packages/github/src/Rest.ts
tags: [bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 7c0d5ffdea01896739e02244ae40a8bfda26bb5113e844ce1fa2939d44afb403
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:33.163Z
---

# @effected/github REST client

The typed REST surface is how a request is spelled, typed and paginated: the
route vocabulary in `Rest.ts` over octokit's generated endpoint map, the
client that keys both parameters and response data off a route literal, the
decoding escape hatch for routes the generated map does not carry, and the
one pagination engine every list read runs through. It owns wire mechanics
only — which endpoints earn a domain method, and how their responses project
into kit values, is [the resource services](github-resources.md); how a
failed request is classified and retried is
[errors and resilience](github-errors-and-retry.md). Package-wide framing is
in [the `github` module](../modules/github.md).

## The route is the key

`client.request("GET /repos/{owner}/{repo}", { owner, repo })` types both the
parameters and the returned data from the route literal alone
(`packages/github/src/Rest.ts`). There is no operation string, no callback
and no type parameter to invent, and no cast — a typed route makes the
projection from response to domain model a checked mapping rather than a
cast, where an operation-string surface costs a cast at every projection.

Two narrowings against octokit's own surface are deliberate:

- **The parameter type intersects a three-field `RequestExtras` record, not
  octokit's own request parameters.** octokit's own type carries an index
  signature that would silently accept every typo. The three kept fields are
  `headers` (an asset content type, a pinned API version), `mediaType`
  (raw content reads) and `baseUrl` (the upload host) — the ones evidence
  proves are needed. Everything else a caller might reach for is a real
  parameter and is already typed.
- **The element type of a paginating route is derived here**, because the
  paginator plugin's own helper — which handles the array-versus-`{
  total_count, items }` split — is not exported. This is what makes a
  paginated read return domain values rather than `unknown[]`.

There is no `operation: string` parameter: the route names the endpoint and
the span carries it.

### `repositoryPatch` owns the cast consumers were writing

`RepositoryPatch` is octokit's generated parameter type, and octokit spells
an optional field as `has_issues?: boolean` — not `has_issues?: boolean |
undefined`. Under `exactOptionalPropertyTypes` (on in this repo's tsconfig
base), a `Partial<T>` assembled from a consumer's own settings schema does
not assign to `RepositoryPatch` at all, so every consumer applying "only
what the user configured" was writing the same `as`.

`RepositoryPatchDraft` is a shape with every field optional and explicitly
`undefined`-able, and `repositoryPatch(draft)` narrows it by dropping keys
whose value is `undefined` — `PATCH` reads an absent field as "leave it
alone," while an explicit `null` or `undefined` is a value. A key-by-key loop
still defeats TypeScript's correlation between two indexed accesses over a
union key, so this residual limitation is recorded rather than fixed: build
the draft as a literal where possible.

### Resource ids come off the wire as `number | bigint`

`@octokit/types` v17 widened every GitHub resource id to `number | bigint`,
future-proofing the generated map against ids past 2^53. The public surface
stays `id: number`: REST payloads arrive through `JSON.parse`, which never
yields a bigint, so the union is a claim about a future that has not
happened. One internal leaf, `packages/github/src/internal/ids.ts`, narrows
it, and every response-mapping site that reads an id goes through it — the
check-run ref, the comment record, the App identity's user id, the
issue-comment writes. A new mapping site adds a call to that funnel, never a
cast. If GitHub ever crosses 2^53, the coercion is not the fix: the `id:
number` fields on the record classes would need redesigning, and the funnel
is where that would show up.

## The escape hatch is from the route table, never from typing

A route GitHub does not document in its OpenAPI schema, or one whose live
shape differs from it, goes through a decoding request that takes a
**mandatory** schema. Two real cases: release-asset upload (omitted by
octokit's generator because it takes a raw binary body on the upload host)
and the attestation reads (a pinned API version, so the live contract
differs from the description).

A hand-written route owns its query parameters in the template. Outside the
generated map, nothing tells octokit that a given parameter is a query
parameter, so a parameter it cannot place is silently dropped — the live
symptom was a rejection on every asset upload, from a call whose arguments
all looked right. The template must spell them, and in two forms rather than
one: an "optional" parameter in an RFC 6570 template is not optional in the
way a caller assumes, since an absent value still expands to a dangling
separator. The general lesson: the typed route table does more work than
routing, and every parameter-placement decision the generated map makes for
free must be made by hand on a route that is not in it — with a dropped
value, not a type error, as the failure mode.

## The client shape

See `packages/github/src/GitHubClient.ts`. One request member, one
decoding-request member, a collected and a streaming paginate, a GraphQL
member, and an effect-valued rate-limit snapshot. Every member is an
`Effect`, a `Stream`, or a function returning one — including the snapshot,
which is an effect-valued property — so the whole shape stays mock-optional
and stubbable from a partial record.

Layer variants: from an explicit token, and from the ambient config
provider. The config variant reads a redacted token and fails with
`ConfigError` — an honest "no token is configured" rather than a
wire-failure type. The layer is then testable by providing a provider, is
not Actions-coupled, and lets a consumer let the config error sit in the
layer's error channel instead of writing a comment justifying an `orDie`.
The App-authenticated variant lives in
[the App module](github-app-auth.md#where-the-app-client-layer-lives), for
reachability reasons.

## Pagination

Three hazards shape the model: a list read that hard-codes its page size
gives the caller no control, a list read that does not paginate silently
truncates (a pull request with more than a page of comments loses its
sticky-comment marker), and a test double that ignores page options makes
truncation structurally untestable.

Four rules:

1. **Every paginating method takes page options and forwards them.** No
   method hard-codes them, and a test drives each list method through a
   counting fixture and asserts the page requests it issued.
2. **The page size is validated, not clamped.** A caller asking for more
   than GitHub's ceiling has a bug — GitHub silently caps and the caller's
   arithmetic is then wrong. Failing typed at the boundary is the intended
   input-hardening posture.
3. **Both a collected and a streaming form share one engine.** The collected
   form is the stream run to completion, and the page bound is applied
   inside the iterator adapter so the traversal stops issuing requests
   rather than filtering after the fact.
4. **A non-paginating route is a compile error**, which an
   operation-string-plus-callback surface could never express.

The engine is octokit's own iterator, not a hand-rolled link walk: its cursor
advances only on success, so wrapping it in the retry re-requests a failed
page rather than skipping it, and it already carries a compare endpoint's
continuation, the search-shaped payload normalization, and the
empty-repository conflict case that would otherwise have been reimplemented.
The page bound and header capture stay on this package's side.

There is exactly one pagination implementation
(`packages/github/src/internal/paginate.ts`), and the seam that keeps it
that way is a page source. One resource pages by file at a fixed size on a
route octokit does not list as paginating (its payload is an object, not an
array), so it constructs pages itself and hands them to the same engine. The
fixture client double in [the `github` module's testing
section](../modules/github.md#testing) feeds the same engine from recorded
arrays, so it cannot drift from the live behaviour.

One documented GitHub constraint stays documented rather than papered over: a
single commit's file list pages by file while a comparison pages by commit,
so a one-commit comparison is permanently truncated at the file cap. One
resource still filters client-side after fetching, because GitHub has no
server-side ref-prefix filter for it, with a short-circuit on the common case
so the full walk is rarely paid.
