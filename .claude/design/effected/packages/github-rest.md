---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - github.md
  - github-errors.md
  - github-resources.md
  - github-graphql.md
---

# @effected/github — the typed REST surface

## Overview

The typed REST surface is how a request is spelled, typed and paginated: the route vocabulary in `src/Rest.ts` over octokit's generated endpoint map, the client that keys both parameters and response data off a route literal, the decoding escape hatch for routes the generated map does not carry, and the one pagination engine every list read runs through.

What it owns is the wire mechanics, and only those. Which endpoints earn a domain method, and how their responses project into kit values, is [the resource services](github-resources.md); how a failed request is classified and retried is [errors and resilience](github-errors.md); and the package-wide framing — tier, dependencies, the repo coordinate and the reachability budget the client shape is cut against — is in [github.md](github.md).

## The route is the key

`client.request("GET /repos/{owner}/{repo}", { owner, repo })` types **both** the parameters and the returned data from the route literal alone. There is no operation string, no callback, no type parameter to invent and **no cast** — the surface this replaced cost four consumer repos sixteen cast sites, and the library itself dozens more inside its own implementation layers, all for the same reason: with a typed route, the projection from response to domain model is a checked mapping rather than a cast.

The route vocabulary lives in one types-only module (`src/Rest.ts`, which emits no runtime code) over octokit's generated endpoint map. Two narrowings against octokit's own surface are deliberate:

- **The parameter type intersects a three-field extras record, not octokit's own request parameters.** That type carries an index signature, and intersecting it would silently accept every typo. The three kept fields are the ones evidence proves are needed: headers (an asset content type, a pinned API version), a media-type format (raw content reads) and a base URL (the upload host). Everything else a caller might reach for is a real parameter and is already typed.
- **The element type of a paginating route is derived here**, because the plugin's own helper — which handles the array-versus-`{ total_count, items }` split — is not exported. Ten lines, one place, and it is what makes a paginated read return domain values rather than `unknown[]`.

**`operation: string` is gone.** There is nothing left for it to name: the route names the endpoint and the span carries it. One consumer had filled it with an invented key unrelated to any endpoint; that has no successor and needs none.

### `repositoryPatch` owns the cast consumers were writing

The no-cast property has one place it does not hold for free, and `src/GitHubRepository.ts` absorbs it there rather than pushing it out. `RepositoryPatch` is octokit's generated parameter type, and octokit spells an optional field as `has_issues?: boolean` — **not** `has_issues?: boolean | undefined`. Under `exactOptionalPropertyTypes`, which is on in this repo and in the silk tsconfig base, a `Partial<T>` assembled from a consumer's own settings schema therefore does not assign to `RepositoryPatch` at all, and every consumer applying "only what the user configured" was writing the same `as`.

`RepositoryPatchDraft` is that shape — every field optional *and* explicitly `undefined`-able — and `repositoryPatch(draft)` narrows it by **dropping keys whose value is `undefined`**. Dropping rather than sending is what the wire needs: `PATCH` reads an absent field as "leave it alone", while an explicit `null` or `undefined` is a value.

**The residual limitation is recorded, because a reader will try to fix it.** A key-by-key loop still defeats TypeScript's correlation between two indexed accesses (`draft[key] = source[key]` over a union `key`), and no helper can fix that — build the draft as a literal where you can.

### Resource ids come off the wire as `number | bigint`

`@octokit/types` v17 widened every GitHub resource id to `number | bigint`, future-proofing the generated map against ids past 2^53. **The public surface stays `id: number`**: REST payloads arrive through `JSON.parse`, which never yields a bigint, so the union is a claim about a future that has not happened rather than a shape any response actually takes.

One internal leaf (`src/internal/ids.ts`, importing nothing) narrows it, and **every response-mapping site that reads an id goes through it** — the check-run ref, the comment record, the App identity's user id, the issue-comment writes. A local cast at each site would have been the same number of edits and would have scattered the assumption; one funnel makes it a single documented decision instead. **A new mapping site adds a call, never a cast.**

If GitHub ever does cross 2^53, the coercion is not the fix and must not be made to look like one: the `id: number` fields on the record classes have to be redesigned, and the funnel is where that shows up. This is the shape an upstream-types widening takes generally — **narrow once at the projection boundary, keep the domain model honest** — and it is why the majors this rode in on (`@octokit/plugin-paginate-rest` 15, `@octokit/types` 17) cost no public change.

## The escape hatch is from the route table, never from typing

A route GitHub does not document in its OpenAPI schema, or one whose live shape differs from it, goes through a decoding request that takes a **mandatory** schema. Two real cases: release-asset upload (omitted by octokit's generator because it takes a raw binary body on the upload host) and the attestation reads (a pinned API version, so the live contract differs from the description).

**A hand-written route owns its query parameters in the template**, and this cuts in a way nobody anticipates. Outside the generated map **nothing tells octokit that a given parameter is a query parameter**, so a parameter it cannot place is silently dropped: the live symptom was a rejection on every asset upload, from a call whose arguments all looked right. So the template spells them — and there are **two spellings rather than one**, because an "optional" parameter in an RFC 6570 template is not optional in the way a caller assumes: an absent value expands to a dangling separator.

The general lesson generalizes past that endpoint: **the typed route table does more work than routing.** Every parameter-placement decision the generated map makes for free must be made by hand on a route that is not in it, and the failure mode is a **dropped value rather than a type error**.

## The client shape

See `src/GitHubClient.ts`. One request member, one decoding-request member, a collected and a streaming paginate, a GraphQL member and an effect-valued rate-limit snapshot. **Every member is an `Effect`, a `Stream` or a function returning one** — including the snapshot, which is an effect-valued property, the core paradigm — so the whole shape stays mock-optional and stubbable from a partial record.

Layer variants: from an explicit token, and from the ambient config provider. The config variant reads a redacted token and **fails with `ConfigError`** — an honest "no token is configured" rather than a wire-failure type. Three things improve at once: the layer is testable by providing a provider, it is not Actions-coupled and a consumer may simply let the config error sit in the layer's error channel instead of writing a comment justifying an `orDie`. The App-authenticated variant lives in [another module](github-auth.md#where-the-app-client-layer-lives), for reachability reasons.

## Pagination

Three defects in the predecessor drove the model: six call sites silently accepted the maximum page size with no caller control, one resource did not paginate at all (so a pull request with more than a page of comments silently lost its sticky-comment marker), and the shipped test double **ignored both page options**, which made truncation structurally untestable.

Four rules:

1. **Every paginating method takes page options and forwards them.** No method hard-codes them, and a test drives each list method through a counting fixture and asserts the page requests it issued.
2. **The page size is validated, not clamped.** A caller asking for more than GitHub's ceiling has a bug — GitHub silently caps and the caller's arithmetic is then wrong. Failing typed at the boundary is the [input-hardening](../effect-standards.md#input-hardening-standards) posture.
3. **Both a collected and a streaming form, sharing one engine.** The collected form is the stream run to completion, and the page bound is applied **inside the iterator adapter** so the traversal *stops issuing requests* rather than filtering after the fact.
4. **A non-paginating route is a compile error**, which an operation-string-plus-callback surface could never express.

**The engine is octokit's own iterator, not a hand-rolled link walk**, and reading the plugin's source settled two things the design could not: its cursor **advances only on success**, so wrapping it in the retry re-requests a failed page rather than skipping it; and it already carries three behaviours we would otherwise have reimplemented — a compare endpoint's continuation, the search-shaped payload normalization and the empty-repository conflict case. The page bound and header capture stay on our side.

**There is exactly one pagination implementation**, and the seam that keeps it that way is a page source. One resource pages **by file** at a fixed size on a route octokit does not list as paginating (its payload is an object, not an array), so it constructs pages itself and hands them to the same engine — which is what that seam is for. The [fixture client double](github.md#testing) feeds the same engine from recorded arrays, so it cannot drift from the live behaviour.

One documented GitHub constraint stays documented rather than papered over: a single commit's file list pages by file while a comparison pages by commit, so a one-commit comparison is permanently truncated at the file cap. And one resource still filters client-side after fetching, because GitHub has no server-side ref-prefix filter for it — with a short-circuit on the common case so the full walk is rarely paid.
