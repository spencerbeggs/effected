---
name: testing-actions
description: Use when writing or reviewing tests for @effected/github-actions, @effected/github, @effected/sbom or @effected/commands — test a GitHub Action, stub the GitHub API, mock GitHubClient, write a service's layerTest/makeTest double, test the pre/main/post lifecycle through Action.run, assert on action outputs or masked secrets, drive the octokit fetch harness, sign a Sigstore bundle with a stub Signer/Witness, or debug why a test is hitting the real network or hanging. Covers which service doubles answer versus die loudly and why, the scripted-fetch harness that runs the REAL octokit client, real-IO recipes for ToolInstaller/BlobStore/HTTP, the two-latch withEnv concurrency instance, the Azure/Redacted.value/Sigstore reachability walkers, and the recorded discriminating mutants for this domain. Does not repeat it.effect, Effect.flip/result, layer() memoization, TestClock, property tests or the false-greens catalog — that is effect-v4-testing; this is its GitHub Actions/GitHub API/supply-chain instance.
---

# Testing GitHub Actions, GitHub API and supply-chain code

This is the domain companion to `effect-v4-testing`, which owns `it.effect`,
`Effect.flip`/`Effect.result`/`Effect.exit`, `layer(...)` and its memoization
trap, `TestClock`, property tests with `it.effect.prop`, the false-greens
catalog, the structural-check anatomy (comment strippers, word boundaries,
the include-vs-notInclude direction rule), the two-latch concurrency rule, and
the mutate-the-edges discipline. **Read that skill first for the general rule
— this one carries only the instance specific to
`@effected/github-actions`, `@effected/github`, `@effected/sbom` and
`@effected/commands`.** Where a heading below matches one there, it points
rather than restates.

## The doubles convention

Every service in these four packages ships `makeTest(overrides?)` +
`layerTest(overrides?)` (`Layer.succeed(Self, Self.makeTest(overrides))`).
**Every unstubbed member dies, naming itself** — there is no `./testing`
subpath, and none of the predecessor's nine `*Test` doubles survives as a
whole-service `Layer.succeed`. That "nine" is the predecessor's retired
count, not today's: 32 services across `github-actions`, `github`, `commands`
and `sbom` ship a `makeTest`/`layerTest` pair today (tallied 2026-08-03,
`grep -rl makeTest` over the four packages' `src/`) — a ~4× larger surface
than the number that describes what's gone, not what exists.

**Writing a new double: the death must be LAZY.** The unstubbed default is
`() => Effect.sync(() => { throw ... })` (or `Effect.die` built lazily), never
`() => { throw ... }`. A throw at *call* time — while the member is being
invoked to DESCRIBE the effect — escapes the Effect runtime entirely, so a
consumer test's `Effect.exit`/`Effect.flip` never sees it and the failure
surfaces as a raw thrown error in the wrong place. Copy the shape from
`ActionOutputs`' `notStubbed`; this exact mistake was reproduced live while
building `CheckDocument.makeTest` (2026-07-26). The canonical shape stubs the ONE member a test
is about and lets the death of the rest prove the test touches nothing else —
this is exactly what a whole-service double hides (fluency-audit Case 4:
reimplementing six members to exercise one):

```ts
// packages/github-actions/__test__/Secret.test.ts:8-20
const recordingOutputs = () => {
  const masked: Array<string> = [];
  const layer = ActionOutputs.layerTest({
    setSecret: (value) =>
      // Effect.suspend: an eager recorder logs calls that were only
      // DESCRIBED, never run.
      Effect.suspend(() => {
        masked.push(value);
        return Effect.void;
      }),
  });
  return { masked, layer };
};
```

Every other `ActionOutputs` member — `setOutput`, `setFailed`, `addMask`,
`saveState`, … — dies with `"ActionOutputs.makeTest: <member>() was called but
not stubbed"` (`packages/github-actions/src/ActionOutputs.ts:131,158-171`) if
this test ever reaches one.

**"Dies loudly" is not universal — the admissibility test is "would a real
implementation legitimately answer this?", not "is it convenient".** The
recorded exceptions, each with its stated reason:

| Service | Default | Why (source) |
| --- | --- | --- |
| `ActionEnvironment.layerTest` | seeds the twelve `GITHUB_*`/`RUNNER_*` variables | one obviously-correct shape, duplicated six times across consumers otherwise (`ActionEnvironment.ts:318-331`) |
| `ActionLogger.layerTest` | defaults to silent | so a suite does not have to stub every log call to avoid a death (`ActionLogger.ts:284-299`) |
| `DryRun.makeTest` | defaults to **rehearsing** (`true`) | the safe direction; the members are the real `make(true)`, so the double cannot drift from production logic (`DryRun.ts:88-100`) |
| `LocalExec.makeTest` (`@effected/commands`) | answers `Option.none()` | *is* the global-only wiring, not a fabrication — dying here would force every consumer test to stub a member it does not care about (`packages/commands/src/LocalExec.ts:186-192`) |
| `IdentityToken.makeTest` (`@effected/sbom`) | answers a real token | a fabricated OIDC token is a real answer to "give me a token" (`IdentityToken.ts:89-99`) |
| `SigstoreSigner.makeTest().sign` (`@effected/sbom`) | **dies** | the opposite judgement on the same test: a fabricated bundle is a signature-shaped lie (`SigstoreSigner.ts:178,224-227`) |

`IdentityToken` and `SigstoreSigner` sit on either side of the same line on
purpose — decide new exceptions the same way.

## Some doubles run the real engine on purpose

- **`BlobStore.layerMemory`** is not a stub: it runs the real `BlobEnvelope`
  framing on `put`/`get` (`packages/github-actions/src/BlobStore.ts:163-190`),
  so a round trip through it proves metadata survives storage rather than
  asserting the double. Reach for `layerTest` only when the test is about the
  service boundary itself, not the framing.
- **`OidcTokenIssuer.layerFor(claims)`** (`OidcTokenIssuer.ts:287-299`) returns
  a **real, decodable** unsigned JWT built from the same `claims` the double
  reports — `token()` and `claims()` cannot disagree. The predecessor's
  synthetic non-JWT made every consumer's `decodeJwtClaims` yield nothing and
  silently skipped the provenance path under test, drawing four apologetic
  TSDoc comments from one consumer (`OidcTokenIssuer.ts:167-171`).
- **`@effected/github`'s fixture double shares the Live pagination engine**
  (`packages/github/src/internal/paginate.ts`) — a narrow, recorded exception
  to "never reimplement a double"; the live client, the fixture double and
  `GitHubCommit.changedFiles` all build a `PageSource` and hand it to the same
  walk (`packages/github/CLAUDE.md`).

## The octokit harness — drive the REAL client, not a double of it

`@effected/github` tests never stub `GitHubClient`. They replace octokit's
documented `fetch` option so the real request path — route interpolation,
retry, classification, Link-header pagination — executes end to end
(`packages/github/__test__/fixtures.ts`, `harness.ts`):

```ts
// packages/github/__test__/harness.ts:28-39
export const harness = (replies: ReadonlyArray<Reply>): Harness => {
  const script = scriptedFetch(replies);
  const base = Layer.mergeAll(
    GitHubClient.layerFromToken({
      token: Redacted.make("ghs_test"),
      fetch: script.fetch,
      retry: RetryPolicy.none,
    }),
    Repo.layer(REPO),
  );
  return { script, base };
};
```

Two facts that cost debugging time before the harness accounted for them:

- **A hand-built `Response` has `url === ""`.** octokit's paginator does `new
  URL(response.url)` for any payload carrying `total_count`, which throws
  `TypeError: Invalid URL` — classified `kind: "transport"`, naming neither
  octokit nor the paginator. `fixtures.ts`'s `toResponse` defines the property
  with `Object.defineProperty(response, "url", { value: url })`
  (`fixtures.ts:57-64`).
- **octokit percent-encodes path parameters.** `heads/main` goes out as
  `heads%2Fmain`. Assert against the harness's decoded `script.calls[i].path`
  (`fixtures.ts:26-31,77`), never the raw `url` field:

  ```ts
  // packages/github/__test__/GitBranch.test.ts:90
  assert.include(script.calls[1]?.path ?? "", "/git/refs/heads/main");
  ```

**`GitHubApp` tests generate a real RSA key with `node:crypto` and sign for
real** (`packages/github/__test__/GitHubApp.test.ts:1,16`) — the JWT signing
path is exercised, not assumed.

## HTTP, filesystem and the runner: real IO where the claim is about IO

- **HTTP goes through `FetchHttpClient.Fetch`**, so request construction,
  status mapping and body decoding execute for real:

  ```ts
  // packages/github-actions/__test__/ToolInstaller.test.ts:26-35
  const live = (root: string, fetch: typeof globalThis.fetch = alwaysFails, env: Record<string, string> = {}) =>
    ToolInstaller.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ActionEnvironment.layerTest({ RUNNER_TOOL_CACHE: root, ...env }),
          NodeServices.layer,
          FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch))),
        ),
      ),
    );
  ```

- **`ToolInstaller` runs under `NodeServices.layer` against real `tar`**
  (same file) — a stubbed filesystem or a fake spawner cannot prove
  stage-then-swap survives a partial failure, or that `tar` actually accepts
  the assembled arguments. `it.live`, not `it.effect`, for these: they touch a
  real filesystem and a real child process, not a virtual clock.
- **Injecting inputs without mutating `process.env`**: `ActionInput.layer(env?)`
  installs `ActionInput.provider(env)` as the `ConfigProvider` reference
  (`packages/github-actions/src/ActionInput.ts:238-251`) — never write to
  `process.env` in a test to fake an input. Point at `actions-inputs-outputs`
  for the full `INPUT_` mangling contract.
- **In-memory doubles are strictly MORE permissive than the runner — round-trip
  state claims through the real layer.** A `Map`-backed `ActionState` double
  happily stores any object; the runner writes a FILE, so the value survives
  only what `JSON.stringify`/`parse` preserves. A `Schema.Option` state schema
  passed every in-memory test and failed on the real runner one phase later
  (its encoded form is an Option *instance*, serialized via `toJSON` into a
  shape the decode rejects). The regression harness that catches this class:
  a temp file as `GITHUB_STATE` + the real `ActionState.layer`, saving in one
  scope and reading back in a fresh one — the double proves the logic, only
  the real layer proves the *serialization*. (Since 2026-08-02 `save` fails
  this typed as `notPlainJson` at save time, but the harness rule stands for
  every file-backed service double.)
- **Faulting one member of a REAL service**: wrap the live service and override
  the member — `Layer.effect(FileSystem.FileSystem, Effect.map(FileSystem.FileSystem,
  (fs) => ({ ...fs, chmod: spy })))` provided AFTER `NodeServices.layer` in the
  merge — real IO everywhere except the one observed call. First-try shape for
  "prove chmod was (not) called" without giving up the real filesystem.

## The actions-specific instances of general traps

`effect-v4-testing` owns each rule below; only the instance is new here.

**`NodeServices.layer` also provides `ChildProcessSpawner`, and in a merge the
LAST provider of a service wins** (probed against beta.101: `Layer.merge` and
`Layer.mergeAll` both resolve a duplicate service to the later layer). An
action test usually needs `FileSystem` (real) and `ChildProcessSpawner`
(scripted) **simultaneously**, so this collision is the normal case, not an
exotic one: `Layer.mergeAll(scriptedSpawner, NodeServices.layer)` silently
replaces the script with the real spawner. A downstream suite wired exactly
that way shelled out to a real `pnpm ci:build` — and PASSED, with correct
output; the only tell was duration, 8.1 s → 24 ms once reordered. Put
`NodeServices.layer` first and the scripted spawner after it (or provide the
spawner separately), and assert the script actually recorded calls. **Green
plus fast is the signal; green alone is not.**

**Mutating `process.env` between reads inside one test file is not a loud
failure — it is a quiet false green.** The environment is seeded once, at
layer construction (`ActionEnvironment.ts:297`), so every later read in the
process returns the FIRST case's value. A parameterized suite injected that
way goes fully green while ten of twelve cases assert against the wrong
input and the rejection cases never see theirs at all — the mechanism-only
reading ("my value is ignored") predicts a loud failure that never comes.
Inject via `ActionInput.layer({ "INPUT_…": value })` per case instead. The
tell: every case passes while the fixture values differ — worth one
skeptical read. (spencerbeggs/effected#190, reported from a live consumer.)

**`ActionEnvironment.layerTest()` seeds `GITHUB_SERVER_URL` with the same
value production code defaults to** — so a test of default-on-absence
behavior against `layerTest()` is a false green: the assertion passes whether
the default logic exists or not. Testing an absence path needs
`ActionEnvironment.layerFrom({})` (a genuinely empty environment), with
`layerTest({ GITHUB_SERVER_URL: "https://ghes.example.com" })` as the
override case. Found while testing `ActionsProvenance.capture`'s
github.com fallback (2026-07-26).

**Two latches minimum for a concurrency-leak test — the `withEnv` instance.**
A single-latch interleaving PASSED against a deliberately wrong save/restore
implementation, because save/restore over a shared global is LIFO-correct
whenever two overrides nest. The discriminating order forces one fiber to
**read while the other's override is still applied and unrestored**
(`packages/github-actions/__test__/ActionEnvironment.test.ts:236-280`, two
`Latch`s named `rightApplied`/`leftDone`).

**Acquire/release a spy on a process global with `Effect.acquireUseRelease`,
never `try`/`finally` inside `Effect.gen`.** A failing assertion leaves through
the error channel, so the `finally` never runs the way the shape suggests, and
a `vi.spyOn(process, "kill")` that survives its own test poisons the control
that proves the guard is not simply refusing everything
(`packages/github-actions/__test__/DetachedProcess.test.ts:43-51`, `withKillSpy`).

**Read the reporter's `unhandledErrors`, not just the pass count.** It is what
caught a detached spawn that reported its own failure correctly through the
typed channel and then, asynchronously, killed the action via an unlistened
`error` event on the underlying `ChildProcess` — 15 green tests once carried
that live defect with nothing in the pass/fail counts showing it.

**Reachability/structural scans strip line comments first, then blocks — the
stripper needs its own discriminating test.** Three domain instances, each
recorded because getting the order backwards fails in the *safe* direction
(a silent false negative), the worst direction for a confinement test:

- The Azure confinement walker
  (`packages/github-actions/__test__/reachability.test.ts:29-47`) — prose
  containing `` `@azure/*` `` opens a block comment as far as a regex is
  concerned; stripping blocks first eats the following import.
- The `Redacted.value` invariant scan
  (`packages/github-actions/__test__/Secret.test.ts:117-169`) — a module's own
  TSDoc *explaining* that it does not call `Redacted.value` was reported as
  calling it, until comments were stripped first.
- The `@sigstore/*` scan in `@effected/sbom`'s reachability suite — this
  package's own prose contains the literal token `` `@sigstore/*` ``, and
  getting the order backwards once reported a module that imports `effect` as
  importing nothing at all (`packages/sbom/CLAUDE.md`, "the reachability
  walker strips LINE comments first").

**Subset runs must be root-relative, and parallel agents need
`--coverage.enabled=false`:**

```bash
pnpm vitest run packages/github-actions --coverage.enabled=false   # from the repo root
pnpm vitest run packages/github --coverage.enabled=false
pnpm vitest run packages/sbom --coverage.enabled=false
pnpm vitest run packages/commands/__test__ --coverage.enabled=false
```

A project-filtered run from **inside** a package prints `Tests: 0/0 passed`
and exits 0 — read the Tests line, not the exit code. Concurrent agents
collide on the shared coverage-reports directory without the flag.

**Known rough edge, so nobody chases it as a regression:** a `ConfigError`
propagating into a failed assertion has been observed to report
`<unserializable>: this.cause.toString is not a function` in the vitest-agent
reporter's rendered output. The failure is still real and still visible via
`consoleLeaks` even when the top-line message renders that way — treat a
`<unserializable>` line as "look at consoleLeaks", not as "the test did not
fail." *(Reporter behaviour, not package API. Recorded from the `github` and
`github-actions` builds, both of which test `Config` failures; the claim rests
on those observations, not on vitest-agent's own source.)*

## The newest discriminating mutant: a suite that injects its own `ConfigProvider`

A test that provides its own `ConfigProvider` — to stub an action's inputs
without touching `process.env` — replaces exactly the seam a bare `Config`
read breaks in production. That is not a hypothetical: a real action's
`Config.string("dry-run")` compiled clean and passed a suite keyed by the
plain input name, because the test's provider and the production read agreed
with each other and never had to agree with the runner. Under the runner the
key is `INPUT_DRY-RUN`; the bare read found nothing; `Config.withDefault`
swallowed the absence (the trap `actions-inputs-outputs` names); and a
`dry-run: true` dispatch ran live.

**At least one test per action must exercise
`ActionInput.layer({ "INPUT_MY-INPUT-NAME": "…" })` with the RUNNER-MANGLED
key — dashes intact, spaces turned to underscores — never the input's plain
name and never a hand-underscored guess.** A suite that only ever stubs a
custom `ConfigProvider` keyed by the plain name cannot fail this way no
matter how the input is misread; the discriminating case is the one where
the test's key and the production mangling must actually agree.

## Mutate the edges before declaring green

The general discipline — baseline, mutate, watch red, revert, confirm against
the baseline not an empty diff — is `effect-v4-testing`'s. The recorded
discriminating mutants for this domain, each of which a passing suite must
actually catch:

- **The pid guard**: mutate `DetachedProcess.reap`'s `0`/`-1`/NaN rejection
  away and `packages/github-actions/__test__/DetachedProcess.test.ts:54-96`
  must go red on the "WITHOUT signalling anything" assertions — a test that
  only checks the effect failed would pass against an implementation that
  signals the whole process group and *then* reports an error.
- **The envelope magic**: mutate the 4-byte `MAGIC` prefix
  (`packages/github-actions/src/BlobEnvelope.ts:46`) or its comparison at
  decode time and the round-trip and legacy-detection tests in
  `__test__/BlobEnvelope.test.ts` must go red.
- **The `INPUT_` mangling**: mutate `inputVariable` to also uppercase dashes
  (`packages/github-actions/src/ActionInput.ts:19`) and
  `Action.test.ts:152-166`'s `INPUT_MY-GREETING` assertion must go red — the
  regression this exists to catch is a consumer reading the wrong spelling
  from `process.env` and shipping it.
- **The `withEnv` scoping**: mutate the save/restore to a bare shared-global
  implementation and the two-latch test above must go red; a single-latch
  version of the same test would stay green.
- **The hex-vs-binary digest**: feed `CacheKey.hashFiles` a per-file digest as
  hex text instead of raw binary and the pinned literal
  `ALPHA_BETA = "24d116e0…"` in `__test__/CacheKey.test.ts:12-22` must go red
  against the wrong-way digest (`e11ab1a1…`) — the literal is pinned rather
  than recomputed specifically so a copied mistake cannot reproduce itself in
  the test.
- **The tool-cache swap**: break the stage-then-rename sequence in
  `ToolInstaller` so a failure leaves a partial directory behind, and
  `__test__/ToolInstaller.test.ts:142-149` ("leaves no staging directory
  behind after a failure") must go red — a `find` that treats any hit as
  complete is exactly the defect this guards.
- **The type-level mutant for `Layer<R, never, ActionServices>`**: narrow
  `ActionRunOptions.layer`'s third parameter back to `never`. This one fails
  **compilation**, not an assertion — the right shape for a regression whose
  original defect was a type constraint a consumer's five-line comment worked
  around (`Action.test.ts:207-238`, "takes a layer requiring the PLATFORM and
  ActionOutputs, with no sub-provide").

## Sibling skills

Point at these by name rather than duplicating their content; they are
authored in parallel and own their own domain:

- `actions-runtime` — the runner lifecycle, `Action.run`, workflow commands.
- `actions-inputs-outputs` — the full `INPUT_`/output contract.
- `actions-state-and-secrets` — `ActionState`, `Secret`, the declassification
  invariant.
- `actions-reporting` — logging and annotations onto the runner.
- `github-api` — the route-is-the-key REST/GraphQL surface.
- `github-app-tokens` — the App JWT and installation-token bridge.
- `supply-chain-attestation` — SBOM, in-toto, SLSA and Sigstore signing.
- `running-commands-and-tools` — `Run`, `ToolDiscovery`, `LocalExec`.
