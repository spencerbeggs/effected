# Testing — @effected/github

Child context file for the two test harnesses: the live client driven through
octokit's `fetch` option, and `GitHubClient.layerFixture`. The parent states
the conventions; this file is the traps and the fixture contract.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

## The live harness (`__test__/fixtures.ts`)

Tests drive the **real** client through octokit's documented `fetch` option,
not a double of our own service — so classification, header capture, retry and
Link-following pagination are all genuinely exercised. Two harness facts worth
knowing before writing a new test:

- A hand-built `Response` has `url === ""`, and octokit's paginator does
  `new URL(response.url)` for any payload carrying `total_count`. The harness
  defines the property; without it you get `TypeError: Invalid URL`, classified
  as `kind: "transport"`.
- octokit percent-encodes path parameters, so `heads/main` goes out as
  `heads%2Fmain`. Assert against `script.calls[i].path` (decoded), not `url`.

`GitHubApp` tests generate a real RSA key with `node:crypto` and sign for real.

## The fixture client's contract

`GitHubClient.layerFixture` pages recorded arrays through **the same pagination
engine the live layer uses**, which is what makes truncation testable and why
it is the narrow exception to the ban on doubles that reimplement behaviour.
Three of its rules changed on 2026-08-13, each because a consumer showed what
the old one cost:

- **An unstubbed route dies.** A missing fixture is test wiring, not a domain
  outcome, so the fiber dies naming the route — the treatment an absent
  `graphql` fixture always had. The old `"fail"` default was only loud in code
  that does not catch: a consumer catching `GitHubError` per resource turned a
  missing stub into a *different execution path*, and 28 tests then failed for
  reasons that named no fixture. `unstubbed: "fail"` restores the typed
  not-found and `"empty"` serves an empty value for a suite whose subject is
  decisions rather than endpoints; `graphql` ignores the setting and always
  dies.
- **A recorded `GitHubError` value *is* the response.** That is how a suite
  stubs a 404, a 422 or a rate-limit deliberately, instead of leaning on a
  route's absence — absence says only "unwired", a recorded error says which
  route fails and why.
- **`fixtures.requested` records every call as a `RecordedCall`** — `kind`,
  `route` (the document name for `graphql`), the **params** the call was made
  with, and `perPage` for a paginated read. Params are what let a suite assert
  what a method *sent*, which is the question a normalising write turns on;
  recording pages alone is why a consumer hand-rolled an ~80-line parallel
  harness, and it is the probe that caught the silent settings drop in
  `@./CLAUDE.resources.md`.

## Properties worth keeping checked

- **A pagination-forwarding test per paginating method** — that is what makes
  "no method hard-codes its page options" a checked property rather than a
  review item, and what stops the single-page regression returning one method
  at a time.
- **Every service ships `makeTest(overrides?)` / `layerTest(overrides?)`**,
  with unstubbed members dying loudly and naming themselves.
- **Pure classes get pure tests, with no layer at all.** The check-run byte
  budget gets a property test over multi-byte and four-byte code points,
  because a counterexample there is a production rejection.
