---
type: Gotcha
title: A mechanically repaired fixture set goes green while describing a state GitHub cannot produce
description: When a source change moves a call to a new route, stubbing that route with whatever makes the suite pass can leave two fixtures disagreeing about the same object, so the test asserts a request sequence the real API would reject.
status: stable
resource: ../../packages/github/src/GitHubClient.ts
stale_after: "2027-03-21T00:00:00Z"
tags:
  - testing
  - github
sources:
  - id: github-client-fixtures
    resource: ../../packages/github/src/GitHubClient.ts
  - id: github-client-test
    resource: ../../packages/github/__test__/GitHubClient.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: e2ed083690c46ea6
---

# A mechanically repaired fixture set goes green while describing a state GitHub cannot produce

## What a reader sees

A source change moves a resource method's call from one route to another —
a listing read becomes a by-name read, say. Every suite that stubbed the old
route through `GitHubClient.layerFixture` now dies with `no fixture for`
naming the new route, because an unstubbed route defaults to `unstubbed:
"die"`[^github-client-fixtures]. The cheapest repair is one edit: stub the
new route with whatever value turns the suite green — a `notFound` for every
fixture set, or an empty value through `unstubbed: "empty"` — and the run
passes.

## What they will wrongly conclude

That the suite still pins the behaviour it pinned before, because every
assertion passes and nothing in the output changed except the fixture table.

## What is actually true

A fixture set is a claim about the world, and a mechanical repair edits the
claim without anyone reading it. The die-default exists to make the *first*
half of the repair loud[^github-client-test]; nothing makes the second half
loud, because each fixture on its own is plausible. The failure shape: one
fixture says the object is present in the listing, the newly added fixture
says the same object 404s by name — a state the API cannot be in — so the
code under test takes its create branch and the suite asserts a `POST` for
an object that exists, which the real API rejects with a 422. The test is
green and the assertion is a lie.

The tell is two fixtures disagreeing about the same object. It is invisible
unless you look for it, so after repairing fixtures ask whether the stubs
describe a state GitHub could actually be in, not merely whether the
assertions pass. Prefer a recorded `GitHubError` value over `"fail"` or
`"empty"` for a deliberate failure — it says which route fails and why,
where absence says only "unwired" — and read every fixture that names the
same object together before calling the repair done.

The same trap applies to any recorded-response double, but this package's
fixture client is where it manufactures a green: the double reimplements no
behaviour, so its only way to lie is through the table it is handed. See
[the `github` module's testing section](../modules/github.md#testing) for the
fixture client's contract.

[^github-client-fixtures]: `packages/github/src/GitHubClient.ts` — the `GitHubFixtures.unstubbed` modes and the reason `"die"` is the default.
[^github-client-test]: `packages/github/__test__/GitHubClient.test.ts` — pins that an unstubbed route dies by default and that a recorded failure is distinguishable from a call never made.
