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
  at: 2026-10-28T18:21:14Z
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:33.163Z
  - by: human:spencer
    at: 2026-10-13T21:42:59Z
integrity:
  generated:
    body: dd4d5dabf75851e1
  verified:
    by: human:spencer
    at: 2026-10-13T21:42:59Z
    content: eb007f76ed8ad6b4
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
  parameter and is already typed. `baseUrl` aims the configured token at
  whatever host it names, with no check against the client's own base; its
  TSDoc, and the raw `request` / `requestDecoded` members', say a caller must
  never fill it from untrusted input. An absolute-URL route string on
  `requestDecoded` does the same.
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

`repositoryPatch(draft, { extra })` is the typed escape hatch for a setting
GitHub accepts before octokit's generated types declare it (effected#1115).
`RepositoryPatchExtra` is an open map minus every key `RepositoryPatch`
declares, so a known key in a literal `extra` is a compile error and has to
go in the draft, where its value is checked; only what octokit has not caught
up with travels unchecked. Because a value already typed `Record<string,
unknown>` assigns to that type anyway (an index signature does not meet an
optional property), `repositoryPatch` checks again at runtime and throws a
`RangeError` for a key in the generated REST key list or in
`GRAPHQL_ONLY_SETTINGS` — a wiring bug, raised where it was written. The
result is still typed `RepositoryPatch`; `updateSettings` sends every key it
carries, and GitHub may ignore an extra silently, since the `PATCH` answers
200 for a field it does not recognise.

For an open map, the matching switch is on the applicator:
`applySettings(settings, { unknownKeys: "send" })` forwards a key neither API
declares on the REST patch instead of ignoring it, and names it in
`AppliedSettings.unverified` (always a subset of `rest`) as well as `rest`.
A key the client's api-version removed is still ignored and GraphQL-only
keys still route to GraphQL, because those two facts are known rather than
merely undescribed; `__proto__` is never sent, since assigning it would set
the body's prototype rather than a field. `unverified` is a required field,
empty under the default `"ignore"`.

### Both write paths send the settings as octokit's `data`

octokit takes a route's path parameters, body fields and transport options
in one flat object, and `@octokit/endpoint`'s `parse` splits it: `method`,
`baseUrl`, `url`, `headers`, `request` and `mediaType` are read as the
request itself, any key the URL template names (`owner`, `repo`) is consumed
as the path, and a `data` key replaces the whole body. `@octokit/request`
then reads `request.fetch` and `request.hook` off the merged options. An open
settings map spread beside `owner` and `repo` could therefore send the
authenticated PATCH to another host with the token attached (the auth hook
adds it to every request), swap its fetch, replace its body, or have an
`owner` / `repo` key silently overwritten while it was reported sent.

So `updateSettings` and `applySettings` send `{ owner, repo, data: body }`
(`patchParams` in `GitHubRepository.ts`): no key inside `data` is ever read
as an option, and confinement holds by construction. The reserved names
(`src/internal/requestOptions.ts`, citing the octokit source) are refused as
well, as defence in depth: `repositoryPatch` throws a `RangeError` for one in
the draft or the extra (`RepositoryPatchReservedKey`, typed `never` in
`RepositoryPatchExtra`), and `applySettings` reports one in `ignored` under
either `unknownKeys` mode, so `rest` and `unverified` name only keys that went
into the body. `RepositoryPatch` omits `Rest.RequestExtras` (`headers`,
`mediaType`, `baseUrl`): in a body they would be fields, not the options they
are named after. A `GitHubClient.layerFixture` records the PATCH's params as
`{ owner, repo, data }`.

### Every open map the kit sends is a `data` body or an allowlist

The settings writes are not the only open map. An audit of every call site
in `src/` that builds octokit params found two more, both now confined the
same way:

- **`DeploymentEnvironment.upsert(name, config)`** sends
  `{ owner, repo, environment_name, data: { ...config } }`. The config used
  to be spread into the flat params (first, so the coordinates won), which
  left `baseUrl`, `headers`, `request` and `data` live. A reserved name
  (`reservedBodyKey` with `ENVIRONMENT_PUT_ROUTE_PARAMS`: the octokit options,
  `owner`, `repo`, `environment_name`, `__proto__`) now dies with a
  `RangeError` before any request; a config naming a coordinate used to
  succeed with the key silently overridden. The fixture records
  `{ owner, repo, environment_name, data }`.
- **GraphQL variables.** `@octokit/graphql` merges a call's variables into
  its request options and lifts `baseUrl`, `headers`, `request`, `mediaType`
  and `operationName` out as the request (its `NON_VARIABLE_OPTIONS`), and
  rejects `query`, `method` and `url`. A variable named `baseUrl` sent the
  authenticated call, token attached, to that host. The transport
  (`internal/octokit.ts`) therefore no longer calls `octokit.graphql`: it
  sends `POST /graphql` with `data: { query, variables }`, rewriting a GHES
  `/api/v3` base to `/api/graphql` as `@octokit/graphql` did, and throws the
  answer's `errors` with its headers so `GitHubGraphQLError.fromThrowable`
  classifies exactly as before. No variable name is refused: GraphQL
  variable names are the document's own namespace, and inside `data` none is
  ever read as an option.

The rest are closed: typed literals of route parameters, conditional spreads
of typed fields, or a fixed allowlist (`CodeScanning`'s `SETUP_KEYS`,
`Ruleset`'s six payload fields); open values (`WorkflowDispatch` `inputs`,
ruleset `rules`, check-run `output`) sit one level down, where octokit reads
nothing. `client.request` itself is the raw surface: its params are the
caller's own, and `Rest.RequestExtras` deliberately lets a call set
`headers`, `mediaType` and `baseUrl` (release-asset uploads use it), so a
caller must never spread an untrusted map into it.

### The release-asset upload host comes from the configured base

Asset uploads go to a separate host: `https://uploads.github.com` on
github.com, `https://<host>/api/uploads` on GitHub Enterprise Server (GitHub's
GHES REST docs for "Upload a release asset"). `GitHubRelease.uploadAsset`
used to hard-code the github.com host, so a client configured for GHES sent
its installation or personal token to github.com. The host is now derived by
`uploadsBaseUrlFor` (`packages/github/src/internal/uploads.ts`) from the base
URL the client was configured with: absent or `https://api.github.com` →
`https://uploads.github.com`; `…/api/v3` → `…/api/uploads`; anything else →
the configured base itself, so the token never goes to a host the caller did
not configure.

The configured base reaches `GitHubRelease` off the public type:
`makeClientShape` marks the shape it builds with a module-private symbol
property, which survives a `{ ...client }` spread. A shape the package did not
build (a hand-written double, `makeTest`, a fixture) carries none and is read
as github.com. The release's own `uploadUrl` is response data, so it is never
the route. It is a cross-check: its origin must equal the derived host's, or
the upload fails `kind: "rejected"` with no status before any request. That
is what refuses a GHES release reached through an unmarked client, rather
than sending the GHES token to github.com.

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
