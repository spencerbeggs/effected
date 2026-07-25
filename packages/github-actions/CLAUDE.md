# CLAUDE.md — @effected/github-actions

The GitHub Actions **runtime**: the services an action needs to talk to the
runner it is executing inside.

Design doc: [`.claude/design/effected/packages/github-actions.md`](../../.claude/design/effected/packages/github-actions.md).
Program frame: `.claude/plans/2026-07-25-github-split-master.md` (Phase 3).

**Status: partial.** Milestones (a) and (b) plus `BlobStore` are green — 213
tests. `ActionCache`, `Artifact`, `BlobStore.githubCache`, `GitHubToken` and
`Action.run` are **not built**. The design doc's as-built section is the
authority on what exists and why; read it before adding a module.

## The line against @effected/github

**`github` talks to the GitHub API; this package talks to the runner.** Nothing
here reads `process.env.GITHUB_REPOSITORY` on `github`'s behalf, and nothing
there imports a workflow command. The two meet at exactly two seams, both of
which live here: the token bridge (`GitHubToken`, unbuilt) and the `Logger` that
maps `Effect.log*` onto workflow commands (`ActionLogger.logger`, built).

`RepoRef`, `InstallationToken`, `BotIdentity` and `GitHubClient` are canonical
in `github` and consumed here. `GitHubContext` / `RunnerContext` and the
workflow-command protocol are canonical **here** — they describe the runner, not
the API.

## Tier: integrated, and the licences that follow

This is the **one place in the kit where `@effect/platform-node` is a required
peer**. A GitHub Action always compiles into a Node process on a GitHub-provided
runner; there is no second platform to abstract over.

Two licences follow, and nothing else in the kit has them:

- **A `node:` import is sanctioned**, for four things core cannot do:
  `node:crypto` (SHA-256 and HMAC — core `Crypto` is RNG-only at beta.101, with
  **no digest**), `node:process.kill` (reaping a bare pid), `node:child_process`
  (the fd-level detached spawn), and `node:zlib`/`node:stream` in the cache and
  artifact codecs.
- **`NodeServices.layer` may be composed directly** in this package's default
  runtime. That is the point of `Action.run`.

**Sanctioned is not unlimited.** Everything that *can* go through a core
contract does: `ToolInstaller` downloads over `HttpClient` and extracts over
`ChildProcessSpawner` in `R`; `CacheKey` reads over `FileSystem`. The `node:`
imports that remain are the four above and the SigV4 primitives.

**No `@actions/*` package, ever.** The cache, artifact and tool-cache protocols
are implemented directly against their HTTP APIs; `@actions/cache` alone drags a
tree larger than this package.

## Invariants

### `Secret.ts` is the only place a secret becomes a string

`Redacted.value` appears nowhere else in `src/`, and **a structural test asserts
it** (`__test__/Secret.test.ts`). Masking and declassification are the same call,
so plaintext cannot be obtained without the runner's log filter already knowing
about it.

This has caught two real leaks — see the design doc. When you hit the third,
**add a member to `Secret` rather than an exception**: `forSigning` exists
because SigV4 needs raw bytes for an HMAC, and it took one line.

The scan **strips comments first**. TSDoc that mentions `Redacted.value` while
explaining that a module does not call it is otherwise reported as a call — the
same phantom-edge problem the bundle-reachability walkers hit with `@example`
imports.

### A guard only a well-typed caller can trip is not a guard

`DetachedProcess.reap` takes a plain `number`, deliberately. The value arrives
as text from another process, so the type system stopped applying the moment it
crossed that boundary. `process.kill(0)` signals the caller's whole process
group and `process.kill(-1)` everything the user owns — on a runner, an
unguarded reap of a state value that decoded to `0` takes down the job running
it. The test asserts `process.kill` recorded **zero calls**, with a control
proving a positive pid does reach it.

`ProcessId` (the schema) is the *other* defense: it refuses the bad value on the
way out of `ActionState`. It decodes to **core's** brand — the subprocess
vocabulary is core's, and this package only supplies the validating constructor
core's `Brand.nominal` is not.

### The tool cache only ever contains complete tools

`ToolInstaller` stages under the cache root and **renames** into place. Copying
straight to the destination leaves a partial tool behind on failure, and `find`
reports a partial directory as a hit — so every later run uses a broken
toolchain and never re-downloads it. The staging directory must stay under the
cache root: a cross-filesystem rename is not atomic.

### Nothing is read from `process.env` except by `ActionEnvironment`

And it reads it **once, at layer construction**, into an immutable map held in a
`Context.Reference`. `withEnv` is therefore fiber-local and parallel-safe, and
`process.env` is never mutated. The source package hand-rolled set/restore and
admitted in a comment that it was not parallel-safe.

The honest cost: a variable exported mid-run by `exportVariable` is not observed
by an already-seeded reader. That matches GitHub's model, where `exportVariable`
targets *subsequent* steps.

### Runner-file delimiters are derived, never random

`EFFECTED_EOF`, extended with `_` until absent from the value. Collision becomes
**impossible** rather than improbable, needs no `Crypto` in `R`, and is
deterministic under test. A value containing the delimiter would terminate its
block early — a value-controlled injection into the runner's own file.

### No caller ever spells a runner variable name

Inputs go through `ActionInput` (which owns the `INPUT_` mangling — GitHub
uppercases and replaces **spaces**, and leaves **dashes alone**); log
annotations go through `ActionLogger.annotated`. Both exist because a consumer
spelled a name wrong and shipped it.

## Errors

**Audit every ported channel for whether it can fire.** The source package has
at least two structurally unreachable ones. When porting a member, either
demonstrate the failure path with a test or delete it from the signature — every
error reason in this package currently has a test that fires it.

`ActionInputError` does not survive: input failures are `ConfigError`.

**`Config.withDefault` reads the *issue*, not the combinator.** An
`InvalidValue` whose `actual` is `None` is classified as *missing data* and
silently defaulted (`Config.ts:304`). This shipped as a real defect — a
malformed `dry-run` input resolved to `false`. Any typed `ConfigError` built
here must carry its `actual`.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — **never `expect`**. Tests in
`__test__/`. No `./testing` subpath, and none of the source package's nine
`*Test` doubles is ported as-is.

- **Every service ships `makeTest(overrides?)` + `layerTest(overrides?)`**, with
  unstubbed members dying loudly and naming the member. Three recorded
  exceptions, each with a stated reason: `ActionEnvironment` seeds the twelve
  `GITHUB_*` variables, `ActionLogger` defaults to silent, `DryRun` defaults to
  rehearsing (the safe direction).
- **`OidcTokenIssuer.layerFor(claims)`** returns a **real decodable** unsigned
  JWT built from the same claims `claims()` reports. That is what makes the
  provenance path reachable; the source package's synthetic non-JWT made it
  structurally untestable and drew four apologetic comments from one consumer.
- **`BlobStore.layerMemory` runs the real envelope framing**, so a round trip
  through it proves metadata survives storage rather than asserting the double.
- **Real IO where the claim is about the filesystem.** `ToolInstaller` runs
  under `NodeServices.layer` against real `tar`.
- **HTTP is tested through `FetchHttpClient.Fetch`**, so request construction,
  status mapping and body decoding all execute.
- **Concurrency tests need two latches, minimum.** A single-latch interleaving
  passed against a deliberately wrong save/restore implementation — save/restore
  is LIFO-correct whenever two overrides nest. The order must force one fiber to
  read while the other's state is applied and **unrestored**.
- **Release a spy on a process global with `acquireUseRelease`**, never
  `try`/`finally` inside `Effect.gen`: a failing assertion leaves through the
  error channel and leaks the spy into the next test.
- **Read `unhandledErrors`, not just the pass count.** It is what caught a
  detached spawn that reported its failure correctly and then killed the action.
- **Mutate the edges before declaring green.** The pid guard, the envelope
  magic, the `INPUT_` mangling, the `withEnv` scoping, the hex-vs-binary digest
  and the tool-cache swap all have recorded, discriminating mutants.

```bash
pnpm vitest run packages/github-actions --coverage.enabled=false   # from the repo root
pnpm build --filter @effected/github-actions
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a
clean gate.

## Bundle reachability: confining Azure

`@azure/storage-blob` is the only heavy external dependency, and the requirement
is structural: **a consumer importing only `ActionOutputs` must be unable to link
Azure.** It may be imported by `ActionCache.ts`, `Artifact.ts` and
`BlobStore.githubCache.ts` **only** — three modules, not the two the spec says;
the Actions-cache Twirp protocol hands back an Azure blob URL.

No shared helper in `internal/` may import it — an internal helper is exactly how
a heavy import leaks into a light module's graph. The three are separate named
re-exports in `index.ts`, **never** gathered into a namespace object.

**Measured, not asserted**: the reachability test needs a control (bundle
`ActionCache` and assert Azure *is* present), and the walker must **strip
comments** before following imports, or `@example` blocks register phantom edges.

This test is owed and unwritten — it belongs with the three modules, which are
also unbuilt.
