---
"@effected/github": minor
---

## Features

### `layerFixture` records every call, with params

`GitHubFixtures.requested` previously logged paginated reads only, as `{ route, perPage }`. `request`, `requestDecoded` and `graphql` named their arguments `_params` / `_variables` and appended nothing, so a suite whose methods all go through `request` could assert the route it hit but nothing about what it sent.

It now records every surface, as the new `RecordedCall`:

```ts
const requested: Array<RecordedCall> = [];
const layer = GitHubClient.layerFixture({ request: { "GET /repos/{owner}/{repo}": data }, requested });

// after the call:
// [{ kind: "request", route: "GET /repos/{owner}/{repo}", params: { owner: "acme", repo: "widgets" } }]
```

`kind` distinguishes `request` / `requestDecoded` / `paginate` / `graphql`; `params` carries what the call was made with (GraphQL variables for `graphql`, whose `route` is the document name); `perPage` still appears on paginated reads.

This closes the gap that made a consumer hand-roll an ~80-line harness to test resource modules whose every method goes through `request`.

### An unstubbed route now dies instead of failing

A route with no fixture entry used to fail with `GitHubError.notFound`. It now **dies**, naming the route — the same treatment an absent `graphql` fixture has always had, and consistent with the rest of the kit's rule that wiring mistakes are defects rather than domain errors.

The reason for the change is worth knowing, because a typed failure looks strictly safer: **it is only loud in code that does not catch.** A consumer whose methods each catch `GitHubError` and report it — a per-resource sync, for instance — turns a missing stub into a *different execution path* rather than a failure. The assertions then fail for a new reason, and nothing in any message names a fixture. That cost one consumer 28 tests reading as ordinary logic bugs.

Two opt-outs, via the new `unstubbed` field:

```ts
GitHubClient.layerFixture({ unstubbed: "fail" })   // the old typed notFound
GitHubClient.layerFixture({ unstubbed: "empty" })  // {} for a request, no items for a page
```

Use `"fail"` when the suite's subject *is* 404 handling — though stubbing the 404 explicitly is better. Use `"empty"` for a suite whose subject is decisions rather than endpoints. `graphql` ignores the field and always dies: its payload is decoded against the document's schema, so no empty value would satisfy it.

## Breaking Changes

An unstubbed route now dies rather than failing typed. A test that asserted `GitHubError.notFound` from an absent fixture sets `unstubbed: "fail"` to keep the old behaviour.

`GitHubFixtures.requested` is typed `Array<RecordedCall>` rather than `Array<{ route, perPage }>`. A test that declares the array with the old inline type needs the new one — the elements now carry `kind` and `params` as well. Assertions that compared whole recorded entries need those two fields added.
