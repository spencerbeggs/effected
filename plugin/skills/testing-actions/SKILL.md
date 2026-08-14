---
name: testing-actions
description: Use when writing or reviewing tests for @effected/github-actions, @effected/github, @effected/sbom or @effected/commands — stubbing the GitHub API, writing a service's layerTest or makeTest double, testing the pre/main/post lifecycle through Action.run, or debugging why a test hits the real network or hangs.
when_to_use: makeTest, layerTest, scripted fetch harness, GitHubClient.layerFixture, two-latch withEnv, reachability walker, discriminating mutant, Sigstore stub Signer, mock GitHubClient
---

# Testing GitHub Actions, GitHub API and supply-chain code

This is the domain companion to `effect-v4-testing`, which owns `it.effect`,
`Effect.flip`/`.result`/`.exit`, `layer(...)` and its memoization trap,
`TestClock`, property tests, the false-greens catalog, the structural-check
anatomy, the two-latch concurrency rule, and the mutate-the-edges
discipline. Read that skill first for the general rule — this one carries
only the instance specific to `@effected/github-actions`, `@effected/github`,
`@effected/sbom` and `@effected/commands`.

## What you have

| Construct | Where | Reach for it when |
| --- | --- | --- |
| `makeTest(overrides?)` / `layerTest(overrides?)` | every service in the four packages | Building a partial double where every unstubbed member dies naming itself |
| `GitHubClient.layerFixture(fixtures)` | `@effected/github` | Recording canned responses — paginated ones through the same engine the live client uses — and **asserting the params a method sent**, not only the route it hit |
| The scripted-`fetch` harness | `@effected/github`'s test suite | Driving the *real* client end to end against canned HTTP |
| `BlobStore.layerMemory` | `@effected/github-actions` | A real-framing in-memory blob store, not a stub |
| `OidcTokenIssuer.layerFor(claims)` | `@effected/github-actions` | A real, decodable unsigned JWT double |
| `ActionInput.layer(env?)` | `@effected/github-actions` | Injecting inputs without mutating `process.env` |
| `ScriptedSpawner` | `@effected/commands` | A scripted `ChildProcessSpawner` double for a fixed command sequence |
| `it.live` vs `it.effect` | `@effect/vitest` | Real filesystem/subprocess IO vs a virtual clock |

## Standards

### The `layerFixture` contract, as of `@effected/github@0.4.0`

Three things changed together, and code written against the older shape is wrong rather than merely dated.

**`requested` records every call, with params.** It is `Array<RecordedCall>` — `{ kind: "request" | "requestDecoded" | "paginate" | "graphql", route, params, perPage? }` — not the old `{ route, perPage }`. It used to log paginated reads only, so a suite whose methods all go through `request` could assert the route and nothing about what it sent. Assert the whole entry:

~~~ts
assert.deepStrictEqual(requested[0], {
  kind: "request",
  route: "GET /repos/{owner}/{repo}",
  params: { owner: "acme", repo: "widgets" },
})
~~~

**An unstubbed route DIES; it no longer fails typed.** A missing fixture is test wiring, not a domain condition, and it is now a defect naming the route — matching what an absent `graphql` fixture always did. The reason the old default was wrong is worth carrying: **a typed failure is only loud in code that does not catch.** A consumer whose methods each catch `GitHubError` and report it turns a missing stub into a *different execution path*, and the assertions then fail for a new reason with nothing naming a fixture. Two opt-outs when you need them: `unstubbed: "fail"` (the old `notFound`) and `unstubbed: "empty"` (`{}` for a request, no items for a page) for a suite whose subject is decisions rather than endpoints.

**A recorded `GitHubError` value IS the response.** That is how you stub a 404 or a 422 deliberately, rather than by leaving a route absent:

~~~ts
GitHubClient.layerFixture({
  request: { "GET /repos/{owner}/{repo}": GitHubError.notFound("read", "repo o/r") },
})
~~~

Absence means unwired; a recorded error means *this route fails, and here is why*. Prefer the second — it names the reason and survives the die-default.

**Paginated routes need the `paginate` key, not `request`.** Every list read in the resource services pages, so a fixture under `request` will die with "no fixture for …". The recorded value is the **whole collection as a bare array**; the fixture pages it through the real engine, which is what makes a two-page test a genuine two-page test.

- **Every service ships `makeTest`/`layerTest`; every unstubbed member dies
  naming itself, lazily.** Build the death as a thunk invoked when the
  member is *called*, never as a bare throw at definition time — a
  call-time throw escapes the Effect runtime and surfaces in the wrong
  place.
- **Stub the one member a test is about; let the rest die to prove the
  test touches nothing else.** Reimplementing several members to exercise
  one is exactly what the canonical single-member-stub shape avoids.
- **Judge a non-dying default by "would a real implementation legitimately
  answer this?", not "is it convenient."** A handful of services are
  recorded exceptions for exactly this reason — see
  [`references/doubles-catalog.md`](references/doubles-catalog.md).
- **Never stub `GitHubClient` in `@effected/github`'s own tests.** Replace
  octokit's `fetch` option instead, so route interpolation, retry,
  classification and pagination all execute for real.
- **Round-trip a file-backed service's claims through the real layer, not
  only through an in-memory double.** An in-memory double is strictly more
  permissive than the runner — it will happily store what a real
  serialization step would reject.
- **Put a real platform services layer first in a merge, and the scripted
  double after it.** The last provider of a duplicated service wins in a
  merge — reversed, a scripted spawner silently gets replaced by the real
  one, and a suite can go green while quietly shelling out for real.
- **Inject action inputs by provider, per case — never by mutating
  `process.env` between reads.** The environment is seeded once, at layer
  construction; mutating it mid-suite is a quiet false green, not a loud
  failure.
- **Exercise at least one input read with the runner-mangled key.** A
  suite that only ever stubs its own `ConfigProvider` keyed by the plain
  input name can't fail the way production does — see
  [`references/mutants.md`](references/mutants.md).
- **Read the reporter's unhandled-errors list, not just the pass count.**
  Some defects — an async error event nothing is listening for — carry
  through a fully green suite with nothing in the pass/fail counts showing
  it.
- **Give a reachability/structural-scan comment-stripper its own
  discriminating test, stripping line comments before block comments.**
  Getting the order backwards fails in the *safe* direction, which is the
  *worst* direction for a confinement test.
- **Run subset suites root-relative, with coverage disabled for parallel
  agents.** A project-filtered run from inside a package silently runs
  zero tests and exits 0 — read the tests-run line, not the exit code.

## Footguns

- Mutating `process.env` between reads inside one test file is a quiet
  false green, not a loud failure — every later read in the process
  returns the first case's seeded value.
- A test double that seeds the same default value production code falls
  back to makes a default-on-absence test pass whether or not the default
  logic actually exists.
- A single-latch concurrency test can pass against a deliberately broken
  save/restore implementation — two latches are the minimum that actually
  discriminates.
- A config-error assertion has been observed to render as an
  unserializable-cause line in the reporter's output — the failure is
  still real; check the captured console output rather than assuming the
  test silently didn't fail.
- An `Effect.catch` whose target's error channel is `never` is dead code,
  and the compiler will not tell you — `catch` over `never` is well-typed,
  it just never fires. Before writing a handler, check the callee's
  declared `E`; if it is `never`, the handler and every branch downstream
  of it (the `null` result, the `❌` log line, the failure verdict) are
  unreachable, and no test can exercise them because the type system has
  already ruled the path out. A failure path that cannot fire is worse
  than none: it reads as coverage to every reviewer who scans past it.
  This is the catch-side mirror of `structuring-an-action`'s declaration
  rule (a tagged error only when the step can actually fail) — audit both
  directions.

## Migrating a suite: doubles first, runner second

When a port moves a suite onto the kit **and** onto `@effect/vitest`, those
are two migrations and they must not share a commit. Port the service
doubles first, keeping the existing runner; convert to `@effect/vitest` as a
separate follow-up.

The reason is specific. Converting the runner installs a `TestClock` **at the
epoch** and a shared `TestConsole` across every converted test in one move. Any
`Effect.sleep` still live in `src` — release-age gates, SBOM timestamps,
`@effected/github` `Resilience` schedules — then stops advancing and hangs to
the Vitest timeout **naming nothing**: no service, no step, no clock. The
failure surfaces at the point furthest from its cause.

The deeper reason is that the existing passing suite **is** the characterization
gate for the port, and a gate rewritten alongside the thing it gates is not a
gate. `effect-v4-testing` documents TestClock-at-epoch as a false green in
isolation; this is its sequencing consequence.

Full process context: [`designing-an-action`](../designing-an-action/references/porting.md).

## Additional resources

- [references/doubles-catalog.md](references/doubles-catalog.md) — the
  full doubles landscape: the lazy-death shape, the recording-wrapper
  recipe, the admissibility table for non-dying exceptions, and the
  services whose doubles run a real engine on purpose. Load when: writing
  a new double or deciding whether one should die or answer.
- [references/octokit-harness.md](references/octokit-harness.md) — the
  scripted-`fetch` harness in full, the real-IO-where-the-claim-is-about-IO
  rules, the platform-layer merge-order trap, the two-latch and
  acquire-release-spy patterns, and the subset-run commands. Load when:
  writing a `@effected/github` test, or deciding whether a test needs real
  IO.
- [references/mutants.md](references/mutants.md) — the recorded
  discriminating mutants for this domain, each written as a scenario a
  passing suite must actually catch. Load when: writing or reviewing a
  test that claims to guard one of these specific behaviors.

## Sibling skills

Point at these by name rather than duplicating their content — they own
their own domain:

- `actions-runtime` — the runner lifecycle, `Action.run`, workflow
  commands.
- `actions-inputs-outputs` — the full `INPUT_`/output contract.
- `actions-state-and-secrets` — `ActionState`, `Secret`, the
  declassification invariant.
- `actions-reporting` — logging and annotations onto the runner.
- `github-api` — the route-is-the-key REST/GraphQL surface.
- `github-app-tokens` — the App JWT and installation-token bridge.
- `supply-chain-attestation` — SBOM, in-toto, SLSA and Sigstore signing.
- `running-commands-and-tools` — `Run`, `ToolDiscovery`, `LocalExec`.
