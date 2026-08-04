# CLAUDE.md — @effected/github-actions

The GitHub Actions **runtime**: the services an action needs to talk to the
runner it is executing inside.

**Design doc:** `@../../.claude/design/effected/packages/github-actions.md`
Program frame: `.claude/plans/2026-07-25-github-split-master.md` (Phase 3).

**Status: complete** (2026-07-25; the `@effected/sbom` seam adapters and the
GitHub-surfaces reporting suite landed 2026-07-26) — 492 tests, zero-warning
build. The design doc's as-built section is the authority on what exists and
why; read it before adding a module.

## The line against @effected/github

**`github` talks to the GitHub API; this package talks to the runner.** Nothing
here reads `process.env.GITHUB_REPOSITORY` on `github`'s behalf, and nothing
there imports a workflow command. The two meet at exactly two seams, both of
which live here: the token bridge (`GitHubToken`) and the `Logger` that
maps `Effect.log*` onto workflow commands (`ActionLogger.logger`, built).

`RepoRef`, `InstallationToken`, `BotIdentity` and `GitHubClient` are canonical
in `github` and consumed here. `GitHubContext` / `RunnerContext` and the
workflow-command protocol are canonical **here** — they describe the runner, not
the API.

## What it takes from the kit

Six `@effected/*` dependencies; three arrived 2026-07-26, `npm` on 2026-07-28,
and every arrow points **inward**.

- `github` — the token bridge's vocabulary (above). `glob` — `CacheKey` matching.
- `npm` — `PackageManagerPin`, consumed by `PackageManagerInstaller` (exact-
  version npm/pnpm/yarn/bun provisioning over `ToolInstaller`) and **confined to
  that one module by the reachability suite**, on Azure's terms: not reachable
  from `ActionRuntime.layer` or any light module; taking it costs the consumer
  one explicit layer line. The result is a discriminated union on `source`
  (`AmbientPackageManager` | `CachedPackageManager`); every tool-cache answer
  carries an `addPath`-able `binDir` — shims written into the **staged** entry
  for the npm-registry managers (never a post-swap mutation; regenerated
  best-effort on a foreign cache hit), bun's own directory for bun.
- `templates` — the region engine under `ManagedDocument` / `CheckDocument`.
  **Not a second engine**: the region grammar, the line-ending invariant and the
  idempotence proof stay in `templates`, which has them under test.
- `markdown` — the GFM writer's escaping, **confined to `GitHubMarkdown.ts`**
  (below).
- `sbom` — `IdentityToken` and `SlsaProvenance`, closed here by
  `ActionsIdentityToken.layer` and `ActionsProvenance.capture`. **`sbom` must not
  depend on the Actions runtime, so the adapter that closes its contract lives
  here** — the same inversion as `commands`' `LocalExec` and `npm`'s
  `CatalogResolver`. Never add the reverse edge.

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

**Masking assumes the runner parses stdout — a detached worker inverts it.**
A worker's stdout is a log file no runner parses, so a mask emitted there is
inert AND writes the plaintext verbatim into the log (a consumer shipped
exactly that for one round). The worker composes `ActionOutputs.layerDetached`
(2026-08-02): `setSecret` a documented no-op, the runner-file members failing
typed (`reason: "detached"`), `setFailed` a plain log line. The parent masks
**before** the spawn, via `Secret.forChildEnv` under the real layer.

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

`ToolInstaller.provisionFile` (2026-08-02) packages the one composition with no
per-tool variation — a single bare binary: `find` → `download` → chmod `0o755`
(skipped when `RUNNER_OS` is Windows, and BEFORE caching, so the cache never
holds a non-executable tool) → `cacheFile`, answering `{ directory, binDir }`
where `binDir` IS the cached directory. A hit **missing the named binary** is a
foreign/partial entry and is reinstalled over, not answered. The bun path in
`PackageManagerInstaller` deliberately does not route through it — integrity
verification and zip extraction sit between its download and chmod.

`ActionCache.save` (2026-08-02) resolves its `paths` as glob patterns before
`tar`, with `actions/cache` parity: matched directories archive recursively,
non-matching patterns (including absent literals) drop silently, an empty
resolution fails typed, and `versionOf` hashes the **literal** pattern list on
both save and restore — exactly as the toolkit's `getCacheVersion` does — so
restore resolves nothing and the versions agree for free. Resolved paths stay
absolute for the `-P` posture (a documented divergence from the toolkit's
workspace-relative entries). The engine is `@effected/glob`, never
`@actions/glob`.

`ActionState.save` (2026-08-02) proves at save time that the encoded form
survives `JSON.stringify`/`parse` and re-decodes, failing typed
(`notPlainJson`, naming the key) instead of leaving a `malformed` mystery for
a later phase — the schema's encoded form must be plain JSON
(`Schema.OptionFromNullOr`, not `Schema.Option`).

`CacheKey.withRestoreDepths` (2026-08-02) lets a key carry an explicit
restore-key ladder — each depth is the number of leading segments a rung keeps,
emitted in the order given — because the default every-prefix ladder drops
digest segments a five-segment key must never lose. `ActionCache.restore` picks
the policy up through the same typed-key path; depths outside
`1..segments.length - 1` are refused at construction. `withoutRestoreKeys()`
(2026-08-02) is the third point in the policy space — the same field carrying
**zero rungs**, so an exact-match-only restore sends an empty `restore_keys`
and never falls back; only *absence* means the default every-prefix ladder.

`CacheKey.digest(input, length = 8)` (2026-08-02) is the segment-safe short
digest for **non-file** key segments (a version list, a branch name) —
sha256, lowercase hex, truncated, guaranteed to satisfy the segment grammar,
so it drops into `CacheKey.of` unchecked. A length outside `1..64` (or a
fractional one) is wiring, not data, and throws a `RangeError`. File content
stays with `hashFiles`.

### The results backend is only reachable from a `uses:` step

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` all speak the Twirp v2
protocol at `ACTIONS_RESULTS_URL` with `ACTIONS_RUNTIME_TOKEN`. The runner
injects both into **action** execution contexts and **not** into `run:` shell
steps, so identical code works from a bundled action and fails when a workflow
invokes it with `node ./main.js`. Every one of the three reports that as
`misconfigured` **naming the absent variable**, because nothing else
distinguishes the two cases.

The runtime token is wrapped in `Redacted` at the read and leaves only through
`HttpClientRequest.bearerToken`, which accepts a `Redacted` directly — so the
declassification seam is never involved and `Redacted.value` still appears only
in `Secret.ts`. The artifact backend ids come from that token's own `scp`
claim, decoded from the plaintext it arrives as, before it is wrapped.

### Nothing is read from `process.env` except by `ActionEnvironment`

And it reads it **once, at layer construction**, into an immutable map held in a
`Context.Reference`. `withEnv` is therefore fiber-local and parallel-safe, and
`process.env` is never mutated. The source package hand-rolled set/restore and
admitted in a comment that it was not parallel-safe.

The honest cost: a variable exported mid-run by `exportVariable` is not observed
by an already-seeded reader. That matches GitHub's model, where `exportVariable`
targets *subsequent* steps.

`GitHubContext.headRef` (2026-08-02) is an `Option<string>`: outside pull
requests the runner does not merely omit `GITHUB_HEAD_REF`, it may write the
**empty string**, and both spellings of absence decode to `None` — the trap is
in the type, not a call-site check. The derived `branch` accessor owns the
universal fallback (headRef when present, else `refName`), so no consumer
hand-rolls the chain again. Encoded form is `string | null`
(`Schema.OptionFromNullOr`), so an encoded context stays plain JSON.

### Child PATH prepends go through `ChildEnv`

`ChildEnv` (2026-08-02) is the pure value-builder for core's spawn options —
zero imports, `WorkflowCommand`'s posture, an exact-empty-edge-set assertion in
the reachability suite. `prependPath(dirs, { base, platform })` answers
`{ env, extendEnv: true }` as **one value** (a bare `env` silently replaces the
child's whole environment), writing through the inherited `PATH` key's own
casing (Windows spells it `Path`, and emitting `PATH` beside it leaves the
winner to a Node-internal case-insensitive dedupe), with the platform's
delimiter and no empty trailing entry for an absent inherited value.
`needsShell(platform)` is the CVE-2024-27980 win32 rule for `.cmd` shims. Two
compositions: a spawner call spreads the whole pair; `DetachedProcess.spawn`
merges over the parent itself and takes `.env` alone. `base` and `platform`
are **required** — this module reads nothing ambient, per the
`ActionEnvironment` invariant above.

### Runner-file delimiters are derived, never random

`EFFECTED_EOF`, extended with `_` until absent from the value. Collision becomes
**impossible** rather than improbable, needs no `Crypto` in `R`, and is
deterministic under test. A value containing the delimiter would terminate its
block early — a value-controlled injection into the runner's own file.

### No caller ever spells a runner variable name

Inputs go through `ActionInput` (which owns the `INPUT_` mangling — GitHub
uppercases and replaces **spaces**, and leaves **dashes alone**); log
annotations go through `ActionLogger.annotated`. Both exist because a consumer
spelled a name wrong and shipped it. The rule extends to tests (2026-08-02):
`ActionInput.provider`/`layer` dual-accept **input-name keys** (`with:`-block
style, `{"biome-version": "…"}`) and mangle internally — an explicit
`INPUT_`-spelled entry still wins — and `ActionInput.variable(name)` exports
the derivation for the rare test that must spell the variable.

**`Action.run` installs `ActionInput.providerOver(ambient)` as the default
`ConfigProvider`** (via `ActionInput.layerDefault`, composed into
`ActionRuntime.layer`), so a bare `Config.string("dry-run")` that side-steps the
accessors degrades to the right answer instead of silently taking its default —
a live action shipped that false green. **Do not remove it**: the design doc's
earlier "the runtime does not install a provider" probe is superseded by the
2026-07-25 ruling below it. Only flat single-segment paths get the `INPUT_`
derivation; nested and numeric paths pass through untouched.

**Absence is one rule across every accessor**: a missing input and an input set
to `""` are both *missing data*, because the runner writes `""` for an input the
workflow omitted. An **optional** input therefore needs `Config.withDefault` (or
`Config.option`) at the call site, or the read fails outright.

## The 2026-07-26 additions, and what will bite you in them

Design detail is in the doc's two dated sections; these are the rules.

- **`ActionsProvenance.capture` owns the OIDC-claims rename once.** Eleven
  all-string fields — a transposed `repository_id` / `repository_owner_id`
  compiles, typechecks and signs the **wrong** provenance. `serverUrl` comes
  from `getOptional` with a `https://github.com` default (absence is not a
  failure), `OidcTokenError` passes through untouched (mandatory-vs-best-effort
  attestation is the *consumer's* policy), and the construct **ends at the
  predicate**.
- **`GitHubMarkdown`'s impossible serializer arm is a defect, not a fallback.**
  A string-joining fallback is the live table-corruption defect this module
  exists to delete. `tableFor(schema)` defines columns once from a row schema —
  declaration order, `title` annotations, **encoded** cell values — so a field
  whose encoded side is not a string makes `format` (and therefore `columns`)
  **required** rather than defaulting to `String(value)`.
- **`CheckDocument` writes only when the render changed.** Byte-identical ⇒ no
  write; **trailing** debounce with a max-wait (leading-edge publishes the one
  state guaranteed to be stale); the finalizer is registered **before** the
  daemon is forked, so the flush cannot race the sink; a failed background pass
  logs and leaves the registry intact — only `flush` surfaces the typed error,
  because a reporting document must not fail the run it reports on.
- **`CheckState` mirrors `github`'s conclusion literals structurally** so the
  module never reaches an API client; a test pins the mirror. Do not "fix" it
  into an import.
- **`ActionLogger.withBuffer({ onSuccess: "discard" })` discards a success and
  nothing else** — failure, defect and interruption all flush, and step
  debugging overrides the discard.
- **`ActionLogger.withStep(name, effect, options?)` (2026-08-04) is the
  summary-line composition** `withBuffer` alone cannot reach: discard-on-success
  plus **one** info line (`summary`, default `✅ <name>`), and a `❌ <name>`
  header emitted through `Console` — ahead of the flush, and deliberately not a
  second `::error::` beside the one `Action.run` renders. The summary is emitted
  **outside** the buffered region; inside, it would be discarded with the
  transcript it replaces, and a green step would print nothing. It survives step
  debugging. Ported from the legacy `Step.groupStep`, whose shape was
  independently derived wrong three times during one port because `group` +
  `withBuffer` looks like complete parity.

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
- **`ActionEnvironment.makeTest`/`layerTest` take the payload as a second
  argument** (2026-08-04), serving `payload` **directly** rather than through a
  `GITHUB_EVENT_PATH` read. `layerTest` hard-provides `FileSystem.layerNoop({})`
  and `make` captures the filesystem at construction, so seeding the path
  through `overrides` sends the read to a noop filesystem — there was no route
  to a payload through the standard double, and a consuming action whose whole
  detection algorithm is a function of the payload rebuilt `makeTest` plus its
  own filesystem stub at every site. `undefined` means *not served*, so an
  unarranged payload still fails typed naming `GITHUB_EVENT_PATH`.
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

## Bundle reachability: confining Azure, and now the markdown engine

`@azure/storage-blob` is the only heavy external dependency, and the requirement
is structural: **a consumer importing only `ActionOutputs` must be unable to link
Azure.** It may be imported by `ActionCache.ts`, `Artifact.ts` and
`BlobStore.githubCache.ts` **only** — three modules, not the two the spec says;
the Actions-cache Twirp protocol hands back an Azure blob URL.

No shared helper in `internal/` may import it — an internal helper is exactly how
a heavy import leaks into a light module's graph. That is why each of the three
carries its **own** ~15-line Azure adapter instead of sharing one: the
duplication *is* the invariant. The three are separate named re-exports in
`index.ts`, **never** gathered into a namespace object.

**`ActionRuntime.layer` excludes all three, for the same reason.** Folding the
cache into the default runtime would put a blob-storage client in the bundle of
every action that merely sets an output. Their requirements are all satisfied by
the runtime, so taking one costs one line:
`Action.run(program, { layer: ActionCache.layer })`.

**`@effected/markdown` is confined the same way, on the same terms**: the
engine is the second-heaviest thing this package can reach and only
`GitHubMarkdown.ts` may import it — measured, with its own control, not
promised. The exact edge sets say the rest: `CheckState.ts` reaches `effect`
alone (in particular **not** `@effected/github`, whose conclusion set it
mirrors), and `ManagedDocument.ts` / `CheckDocument.ts` reach
`@effected/templates` and no more. `ActionRuntime.layer` still excludes the
three Azure modules and is unchanged by any of this — `Action.ts` reaches
`@effect/platform-node`, `effect` and `effect/unstable/http`, nothing else.

**Measured, not asserted** — `__test__/reachability.test.ts` walks the runtime
import graph with a control (the three *do* reach Azure), exact edge-set
assertions for the light modules, and its own discriminating test for the
comment stripper. The stripper takes **line comments first, then blocks**: prose
containing `@azure/*` opens a block comment as far as a regex is concerned, so
stripping blocks first eats the imports that follow — failing in the safe
direction, which for a confinement test is the worst one.

## The transport seam

The three Azure modules take their transport as an argument: `FileBlobTransfer`
(whole files, for the cache and artifacts) and `DataBlobTransfer` (buffers, for
the blob store), with `layerWith(transfer)` beside each `layer`. The protocol —
the RPC sequence, conflict handling, version derivation, retry policy and
framing — is what this package owns and what the tests execute; the pre-signed
`PUT` is not. Same shape as `@effected/sbom`'s `SigstoreSigner.layerWith`, and
it is also how an integration test points the real protocol at a local endpoint.

Twirp retry lives **inside** `internal/twirp.ts`, keyed on a *structured*
failure (`transport` / `status` / `malformed`), so no protocol can ship without
it and a reworded message is not a silent policy change. Both field spellings
(`signedUploadUrl` and `signed_upload_url`) are read: the backend's two halves
disagree, and guessing wrong presents as "the cache silently never hits".

## The token bridge's one-hour contract

An installation token lives about an hour and **no later phase can re-mint one**
— the credential that could is the app's private key, and persisting *that*
through `GITHUB_STATE` would trade a one-hour token for a permanent one. So
`GitHubToken.read` fails typed (`GitHubTokenError`, `reason: "expired"`) rather
than handing back a token that answers `401` with no explanation, and a phase
that can outlive the hour calls `provision` itself. `dispose` skips revoking an
already-expired token: GitHub has stopped accepting it, so the request could
only turn a successful run into a failed one on the way out.

`provision` is an `acquireUseRelease` whose release arm **revokes** — a workflow
retrying a failing `pre` would otherwise leave an hour of unreferenced write
tokens behind. Its member-usage table is in the module's TSDoc and is
**executable**: one test supplies exactly the documented members and passes,
another supplies one fewer and dies.
