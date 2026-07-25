---
status: draft
module: effected
category: architecture
created: 2026-07-25
updated: 2026-07-25
completeness: 70
related:
  - ../effect-standards.md
  - ../roadmap.md
  - github.md
  - commands.md
  - ../../plans/2026-07-25-github-split-master.md
  - ../../plans/2026-07-25-silk-runtime-action-survey.md
---

# @effected/github-actions design

## Overview

`@effected/github-actions` is the **GitHub Actions runtime** for the kit: the services an action needs to talk to the runner it is executing inside. Inputs, outputs, state that survives the `pre`/`main`/`post` phase boundary, the workflow-command log protocol, the runner's cache and artifact stores, tool installation, OIDC tokens, and the GitHub App token bridge that turns [`@effected/github`](github.md)'s `GitHubApp` into an action-shaped lifecycle.

The line against `@effected/github` is sharp and worth stating first, because the source package blurred it: **`github` talks to the GitHub API, `github-actions` talks to the runner.** Nothing here reads `process.env.GITHUB_REPOSITORY` on `github`'s behalf, and nothing there imports a workflow command. The two meet at exactly two seams — the [token bridge](#githubtoken-the-bridge-and-its-member-usage) and the [`Logger` that maps Effect logs to workflow commands](#actionlogger-and-the-workflow-command-protocol) — both of which live here.

It is ported from `@savvy-web/github-action-effects`. That package is **already on Effect v4** (it imports `effect/unstable/http` and uses the v4 `Context.Service` form), so this is a redesign rather than a version migration: the deltas below are about shape, testability and dependency confinement, not about v3 API renames.

Scope is closed by six consumers — the five in the spec plus **silk-runtime-action**, whose [survey](../../plans/2026-07-25-silk-runtime-action-survey.md) added `BlobStore`, detached-process lifecycle and the cross-process secret handoff to the requirements.

## Tier and dependencies

**Integrated tier by construction, and the one place in the kit where `@effect/platform-node` is a required peer** ([master plan](../../plans/2026-07-25-github-split-master.md) decision 10). A GitHub Action always compiles into a Node process on a GitHub-provided runner; there is no second platform to abstract over, and pretending otherwise would cost every consumer a layer they can only satisfy one way.

```jsonc
{
  "dependencies": {
    "@effected/github": "workspace:~",
    "@azure/storage-blob": "^12.33.0"
  },
  "peerDependencies": {
    "effect": "catalog:effect:peers",
    "@effect/platform-node": "catalog:effect:peers"   // NOT optional
  }
}
```

Two consequences follow, and both are licences the rest of the kit does not have:

- **A `node:` import is sanctioned here.** The [require-in-R default](../effect-standards.md#the-consolidated-core-and-the-require-in-r-default) calls a direct `node:` import a code smell *most of the time*; the documented exception is a Node-only overlay, and this whole package is one. It is used for four things core cannot do: `node:crypto` for SHA-256 and HMAC (see below), `node:process.kill` for [reaping a bare pid](#detached-processes-and-the-bare-pid-guard), `node:child_process` for the [fd-level detached spawn](#the-fd-routing-gap), and `node:zlib`/`node:stream` in the cache and artifact codecs.
- **`NodeServices.layer` may be composed directly** in this package's default runtime, rather than left to the consumer. That is the point of `Action.run`.

**Core `Crypto` does not cover hashing.** Verified against `.repos/effect` at beta.101: `effect/Crypto` exposes `random`, `randomBoolean`, `randomInt`, `randomUUIDv4`, `randomUUIDv7` — random-number generation only, with no digest or HMAC. So `hashFiles`, the S3 SigV4 signer and the cache-key derivation all use `node:crypto`, and **no `@aws-sdk/*` dependency is needed for SigV4** — the source package already proves this with a ~100-line `internal/sigv4.ts` over `node:crypto`. Recorded because "put it on core `Crypto`" is the obvious wrong guess.

What is deliberately **not** a dependency: any `@actions/*` package. The source package does not use them either — it implements the cache, artifact and tool-cache protocols directly against their HTTP APIs. That stays, because `@actions/cache` alone drags a dependency tree larger than this package.

## Bundle reachability: confining Azure

`@azure/storage-blob` is the only heavy external dependency, and the requirement is structural: **a consumer that imports only `ActionOutputs` must be unable to link Azure.** In the source package it is imported by exactly three modules — `ActionCacheLive`, `ArtifactLive` and `GitHubBlobStoreLive` — and that is the boundary this design keeps.

Note the correction to the spec, which says Azure is "confined to `ActionCache` and `Artifact`": the **GitHub-cache `BlobStore` backend uses it too**, because the Actions cache's Twirp v2 protocol hands back an Azure blob URL for the payload. Three modules, not two.

The rules that make the confinement hold:

- Azure is imported by `ActionCache.ts`, `Artifact.ts` and `BlobStore.githubCache.ts` **only**. No shared helper in `internal/` may import it, because an internal helper is exactly how a heavy import leaks into a light module's graph.
- The three modules are separate named re-exports in `index.ts`, never gathered into a namespace object — the [codec hazard](../effect-standards.md#no-barrel-re-exports) applies verbatim: `export const Stores = { cache, artifact, blob }` would make every one of them reachable from any of them.
- **Measured, not asserted.** A bundle-reachability test with a control, copying [github's](github.md#testing): bundle a program importing only `ActionOutputs` and assert `@azure/storage-blob` is absent from the module graph; bundle one importing `ActionCache` and assert it is present. Without the second assertion the first can pass for the wrong reason.

## Module map

Module-per-concept, no barrels, `src/index.ts` re-exports only.

| Module | Owns | Heaviest import |
| --- | --- | --- |
| `src/Action.ts` | `Action.run`, `ActionRuntime` (the composed default layer), phase entry | `@effect/platform-node` |
| `src/ActionEnvironment.ts` | the env service, `GitHubContext`, `RunnerContext`, the scoped override | — |
| `src/ActionInput.ts` | `Config`-backed input accessors and the `INPUT_` provider | — |
| `src/ActionOutputs.ts` | outputs, summary, `exportVariable`, `addPath`, `setSecret`, `setFailed` | — |
| `src/ActionLogger.ts` | groups, the buffering step logger, annotations, the workflow-command `Logger` | — |
| `src/ActionState.ts` | `GITHUB_STATE` persistence across `pre`/`main`/`post` | — |
| `src/WorkflowCommand.ts` | the `::command::` wire protocol, pure | — |
| `src/DryRun.ts` | the dry-run guard | — |
| `src/Secret.ts` | **the declassification seam** — masked handoff of `Redacted` values | — |
| `src/GitHubToken.ts` | the App-token lifecycle bridge onto `@effected/github` | `@effected/github` |
| `src/OidcTokenIssuer.ts` | `id-token: write` OIDC tokens | — |
| `src/CacheKey.ts` | `hashFiles`, restore-key ladders, branch-aware derivation — **pure + FS** | — |
| `src/ActionCache.ts` | the Actions cache protocol | `@azure/storage-blob` |
| `src/Artifact.ts` | the Actions artifact protocol | `@azure/storage-blob` |
| `src/BlobEnvelope.ts` | **pure**: the schema-versioned metadata frame | — |
| `src/BlobStore.ts` | the `BlobStore` service + the S3 backend | — |
| `src/BlobStore.githubCache.ts` | the Actions-cache Twirp v2 backend | `@azure/storage-blob` |
| `src/ToolInstaller.ts` | download / extract / cache a toolchain | — |
| `src/DetachedProcess.ts` | detached spawn, readiness probe, the bare-pid reap guard | `node:child_process` |
| `src/internal/` | the workflow-command writer, the runner-file writer, SigV4, the Twirp client | — |

Twenty modules against the source package's eleven runtime services. The growth is deliberate: framing (`BlobEnvelope`), cache-key derivation (`CacheKey`), the secret seam (`Secret`) and detached-process lifecycle (`DetachedProcess`) were all **consumer-side hand-rolls** the survey found, not new inventions.

## `ActionEnvironment`, and the two friction fixes

```ts
export interface ActionEnvironmentShape {
  readonly get: (name: string) => Effect.Effect<string, ActionEnvironmentError>;
  readonly getOptional: (name: string) => Effect.Effect<Option.Option<string>>;
  readonly github: Effect.Effect<GitHubContext, ActionEnvironmentError>;
  readonly runner: Effect.Effect<RunnerContext, ActionEnvironmentError>;
  readonly isDebug: Effect.Effect<boolean>;
  readonly payload: Effect.Effect<WebhookPayload, ActionEnvironmentError>;   // R = never
  readonly repo: Effect.Effect<RepoRef, ActionEnvironmentError>;             // R = never
  readonly withEnv: <A, E, R>(
    overrides: Record<string, string>,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}
```

**Fix 1 — `payload` loses `FileSystem` from its `R`.** Today it reads `GITHUB_EVENT_PATH` and so carries `FileSystem` into every caller's requirements, which is why silk-router-action captures `fs` at layer construction and re-injects it per call behind a three-line apology (spec §5). The fix is the [git precedent](github.md#the-repo-coordinate): the **layer** requires `FileSystem`, resolves it once at construction, and every member's `R` is `never`. `repo` and `issue` inherit the fix. This is not a new capability — it is the same capability with the requirement in the right place.

**Fix 2 — the scoped env override is parallel-safe, because it never touches `process.env`.** silk-release-action hand-rolls set/restore around a sub-Effect and admits in a comment that it "is not parallel-safe" (spec §7). Mutating a process-global cannot be made parallel-safe; the answer is to stop treating `process.env` as the source of truth at read time.

The layer seeds an immutable env map from `process.env` once at construction and holds it in a **`Context.Reference`** — verified present at `Context.ts:1335`, and the v4 spelling of what v3 called a `FiberRef` (there is no `FiberRef` module in v4; `References.ts` and `Context.Reference` are what exist). `withEnv` runs its effect with the reference locally overridden, so the override is **fiber-scoped**: two fibers overriding the same variable concurrently see their own values, and neither leaks into the other or into the real process environment. Nothing to restore, nothing to race.

The cost is honest and must be documented: a variable exported by `ActionOutputs.exportVariable` mid-run, or set by a child process, is not observed by an already-seeded reader. That is the correct trade — an action's environment is fixed at start by GitHub's own model, and `exportVariable` targets *subsequent steps*, not the current one.

## `ActionInput` — `Config`-backed, and richer than `@actions/core`

Inputs are read through a `ConfigProvider` that owns the `INPUT_` name mangling, never through `process.env` directly. This closes a documented production bug: silk-release-action read `process.env["INPUT_SBOM_CONFIG"]` and silently got nothing, because GitHub's real variable is `INPUT_SBOM-CONFIG` — the runner uppercases and replaces **spaces** with underscores, and leaves dashes alone (spec §5). A `Config`-backed accessor makes that class of bug unrepresentable, because no consumer spells the variable name.

```ts
export const ActionInput: {
  readonly string: (name: string) => Config.Config<string>;
  readonly boolean: (name: string) => Config.Config<boolean>;   // YAML 1.2 core schema
  readonly integer: (name: string) => Config.Config<number>;
  readonly redacted: (name: string) => Config.Config<Redacted.Redacted<string>>;
  readonly lines: (name: string) => Config.Config<ReadonlyArray<string>>;
  readonly list: (name: string) => Config.Config<ReadonlyArray<string>>;
  readonly pairs: (name: string) => Config.Config<Record<string, string>>;
  readonly schema: <A, I>(name: string, schema: Schema.Codec<A, I>) => Config.Config<A>;
};
```

`lines` is the `@actions/core`-faithful newline split. `list` and `pairs` are the two shapes consumers reinvented — silk-update-action parses JSON arrays, bullet lists and comma-separated values; silk-sync-action strips comments and parses `key=value` (spec §5). Both are now one implementation with one set of tests, rather than two divergent ones with none.

**`ActionInput` is grouped statics, not a namespace object over engines.** Every member reaches `Config` and nothing else — the [`MergeStrategy` carve-out](../effect-standards.md#no-barrel-re-exports) exactly.

## `ActionLogger` and the workflow-command protocol

`WorkflowCommand.ts` is **pure**: it renders `::name key=value::message` strings with the required escaping, and nothing else. It is the one piece of this package a non-Actions consumer might legitimately want, and keeping it pure means it is testable without a runner.

`ActionLogger` owns groups, the buffered step renderer and annotations. The important design point is the seam with the rest of the kit: **every `@effected` package logs with `Effect.log*`, and this package ships the `Logger` that maps those logs onto workflow commands** (`::debug::`, `::warning::`, `::error::` with `file`/`line` annotations). That is why [`@effected/github` deleted its `silentOctokitLog` hack](github.md#actions-decoupling) — the mapping belongs to one `Logger` at the edge, not to each library.

Two friction fixes:

- **`ActionLogger.layerSilent()`** — the spec counts `Effect.provide(Logger.layer([]))` **13 times** in silk-release-action and **23** in silk-sync-action, purely to silence logs in tests. One named layer replaces all 36.
- **The buffered step renderer stays**, because it is what makes an action's log readable, but `withBuffer` is no longer wrapped around the whole program by `Action.run` implicitly — an unhandled defect inside a buffer swallowed the output in the source package. `Action.run` flushes buffers on every exit path, including a defect.

## Secrets: the declassification seam

This is the [Phase 3 design question the decisions log records](../../plans/2026-07-25-github-split-decisions-log.md) (decision 14), and the survey's second unique need: silk-runtime-action degrades `Redacted` values to plaintext `TURBOGHA_*` env vars for a detached child, and re-wraps them on the far side.

**`Redacted` cannot survive serialization, by design.** That is not a defect to work around; it is the whole value of the type. So the design does not try to make it serializable. It makes **declassification explicit, auditable and impossible to do quietly** — one module, `Secret.ts`, is the only place in the package where a secret becomes a string.

```ts
export class Secret {
  /**
   * Declassify secrets for a child process's environment.
   * Every value is masked via `ActionOutputs.setSecret` BEFORE it is returned.
   */
  static readonly forChildEnv: (
    entries: Record<string, Redacted.Redacted<string>>,
  ) => Effect.Effect<Record<string, string>, never, ActionOutputs>;

  /** Declassify one secret for a runner file (GITHUB_STATE / GITHUB_OUTPUT). Masks first. */
  static readonly forRunnerFile: (
    secret: Redacted.Redacted<string>,
  ) => Effect.Effect<string, never, ActionOutputs>;

  /** The far side: re-wrap a plaintext handoff, and refuse an empty one. */
  static readonly adopt: (name: string) => Config.Config<Redacted.Redacted<string>>;
}
```

The invariant that makes this worth a module: **you cannot obtain plaintext from this package without the runner mask having been applied first**, because masking and declassification are the same call. `Redacted.value` appears nowhere else in the package, and a test asserts that — a grep-style structural test over `src/`, which is cheap and catches the reintroduction.

`ActionState` gets the same treatment rather than a second mechanism: `saveSecret(key, secret)` masks then persists, because `GITHUB_STATE` is plaintext by GitHub's protocol and the mask is the only available defense. [`@effected/github` deliberately does neither](github.md#the-seam-effectedgithub-actions-needs) — masking is an Actions output command and persistence is an Actions file, so both are this package's job.

What this does **not** attempt: encrypting the handoff. The child runs on the same runner as the parent under the same user; an encryption key would have to travel the same channel as the secret, which buys nothing but ceremony.

## `GitHubToken`: the bridge, and its member usage

Five phase-oriented statics over [`@effected/github`](github.md#the-seam-effectedgithub-actions-needs)'s `GitHubApp`. Grouped statics on one module reaching one dependency — the carve-out, not the hazard.

```ts
export class GitHubToken {
  static readonly provision: (options?: ProvisionOptions) =>
    Effect.Effect<InstallationToken, GitHubAppError | TokenPermissionError | ActionStateError | ConfigError,
                  ActionState | ActionOutputs | GitHubApp>;
  static readonly clientLayer: () => Layer.Layer<GitHubClient, ActionStateError, ActionState>;
  static readonly read: () => Effect.Effect<InstallationToken, ActionStateError, ActionState>;
  static readonly botIdentity: () => Effect.Effect<BotIdentity, ActionStateError, ActionState>;
  static readonly dispose: () => Effect.Effect<void, GitHubAppError | ActionStateError, ActionState | GitHubApp>;
}
```

The spec's explicit ask is that requirements stop being opaque — "under partial mocks this becomes runtime `UnimplementedError` roulette" (spec §5). So, **per exported member, which members of each requirement it touches**:

| Function | `ActionState` | `ActionOutputs` | `GitHubApp` | Notes |
| --- | --- | --- | --- | --- |
| `provision` | `save` | `setSecret` | `token`, `identity`, `revoke` | `revoke` only on the failure path (see below) |
| `clientLayer` | `get` | — | — | Builds `GitHubClient.layerFromToken` from the persisted token |
| `read` | `get` | — | — | — |
| `botIdentity` | `get` | — | — | `InstallationToken.botIdentity()` is pure |
| `dispose` | `getOptional` | — | `revoke` | `getOptional`, so a `post` with no `pre` is a no-op, not an error |

A partial mock is now built from that table rather than from a stack trace. It is also the contract a test asserts: a `layerTest` supplying exactly those members must satisfy each function, and supplying one fewer must fail — which is a real test, not documentation.

Three behaviors carried deliberately from the source, because each was load-bearing:

- **Failed provisioning revokes.** `provision` is an `acquireUseRelease`: if scope verification or persistence fails, the minted token is revoked rather than left alive until GitHub expires it. Defense-in-depth for retry loops.
- **The token is masked before it is persisted**, not after — via `Secret.forRunnerFile`, so the ordering is structural rather than remembered.
- **Identity resolution degrades.** A `GET /app` hiccup logs a warning and yields a token without identity fields rather than failing the action; the commit identity falls back to `github-actions[bot]`.

## `BlobStore` and the metadata channel

The headline of the [silk-runtime-action survey](../../plans/2026-07-25-silk-runtime-action-survey.md). Today `BlobStore` is `get`/`put`/`has` over raw `Uint8Array`, with **no metadata channel** — so the consumer hand-rolls a binary frame (`[4B tagLen][4B durationMs][tag][body]`) and namespaces keys by a `v2` prefix to represent a format change. Both are framing concerns leaking into a consumer, and both are what this design absorbs.

### The envelope is a pure, schema-versioned module

`BlobEnvelope.ts` owns the wire format and nothing else — no IO, no service, fully testable from a byte array:

```text
[4B magic  "EBS1"]
[1B envelope version]
[4B metadata length, big-endian u32]
[metadata: UTF-8 JSON of the caller's ENCODED metadata]
[body: the remaining bytes, verbatim]
```

```ts
export class BlobEnvelope {
  static encodeResult: <A, I>(metadata: A, body: Uint8Array, schema: Schema.Codec<A, I>) =>
    Result.Result<Uint8Array, BlobEnvelopeError>;
  static decodeResult: <A, I>(bytes: Uint8Array, schema: Schema.Codec<A, I>) =>
    Result.Result<{ readonly metadata: A; readonly body: Uint8Array }, BlobEnvelopeError>;
}

export class BlobEnvelopeError extends Schema.TaggedErrorClass<BlobEnvelopeError>()("BlobEnvelopeError", {
  reason: Schema.Literals(["notAnEnvelope", "unsupportedVersion", "truncated", "metadataDecodeFailed"]),
  // …sized to what a caller reads
}) {}
```

Four decisions carry it:

- **The magic prefix makes a legacy blob legible.** A raw, unframed payload decodes as a typed `notAnEnvelope` rather than as garbage metadata, so a consumer migrating existing cache entries gets a clean miss instead of a corrupt read.
- **The version lives in the blob, not in the key.** That is the direct fix for the consumer's `v2` key-namespacing: a format change is detected on read (`unsupportedVersion`) and the cache entry is simply a miss, so **keys stay stable across format revisions** and old entries age out naturally.
- **Metadata is the caller's schema, not a fixed shape.** The consumer's `tag` and `durationMs` become ordinary fields of a `Schema.Class` they own. The package owns *framing*; the consumer owns *meaning*.
- **`Result`-returning primitives** per the [sync-primitive policy](../formatter-convention.md#decision-6--the-sync-primitive-policy) — framing is pure computation, so the `Result` form is the primitive.

### The service

```ts
export interface Blob<A> { readonly metadata: A; readonly body: Uint8Array }

export interface BlobStoreShape {
  readonly get: <A, I>(key: string, schema: Schema.Codec<A, I>) =>
    Effect.Effect<Option.Option<Blob<A>>, BlobStoreError | BlobEnvelopeError>;
  readonly put: <A, I>(key: string, blob: Blob<A>, schema: Schema.Codec<A, I>) =>
    Effect.Effect<void, BlobStoreError | BlobEnvelopeError>;
  readonly has: (key: string) => Effect.Effect<boolean, BlobStoreError>;
}
```

The per-call schema argument is **not a new idiom** — it is exactly the shape `ActionState.save/get(key, value, schema)` already has in this package, which is the consistency argument for choosing it over a layer-baked or type-parameterized service.

No `list`, no `delete`: eviction is the backend's, and the survey confirms no consumer wants them. Adding them would mean designing an eviction story for two backends that both already have one.

Two backends, both requiring core `HttpClient` (`effect/unstable/http`) in their layer:

- **`BlobStore.layerGitHubCache`** — the Actions cache Twirp v2 protocol. Azure-touching, hence its own module.
- **`BlobStore.layerS3(config)`** — SigV4, **path-style** addressing and a custom endpoint, which is what makes it work against R2, MinIO and Spaces rather than only AWS. Config carries `bucket`, `region`, `endpoint?`, `accessKeyId`, `secretAccessKey: Redacted`, `sessionToken?: Redacted`, `prefix?`. Signing is `node:crypto` HMAC — no AWS SDK, per the [Crypto finding](#tier-and-dependencies).

## `Artifact` — ships in v1, and the name collision that nearly sank it

**Ruled in v1** (Spencer, 2026-07-25). The evidence trail is recorded here because a thorough search found no *direct* consumer of this service, and the reason is a name collision worth naming once so it is not re-litigated from the same confusion.

### What the search actually found

| Searched | Result |
| --- | --- |
| `uploadArtifact` / `listArtifacts` / `downloadArtifact` / `getArtifact` / `ArtifactLive` / `ArtifactTest` across all six consumers' `src` and tests | **no hits** |
| bare `Artifact` across all six consumers | one hit, a code comment in `silk-runtime-action/src/services/turbo-cache/handler.ts:7` about the **Turbo cache codec's** frame version — unrelated |
| `actions/upload-artifact` / `download-artifact` in silk-release-action's seven workflow files | **no hits** |
| importers of `services/Artifact.js` inside the source package | `index.ts`, `testing.ts`, `ArtifactLive.ts`, `ArtifactTest.ts` — its own barrel, layer and double. **No internal consumer**, including `Attest` |

What silk-release-action *does* have is two different things that both read as "artifact work":

- **`GitHubArtifactMetadata.createStorageRecord`** — `src/main.ts:36,1121`, `src/release/releases.ts:24,34,267-297,374,768-780`, and eight fixtures in `releases.test.ts`. This is the **GitHub Packages storage record**, and [github.md](github.md#module-map) already assigns it to `@effected/github` as `src/ArtifactMetadata.ts`.
- **Release assets** — `tarMetaFolder` (`src/release/meta-archive.ts`) packs a `meta/` folder into a `.meta.tgz` that is uploaded as a **GitHub Release asset** (`src/release/releases.ts:472-490`), which is `@effected/github`'s `GitHubRelease`.

Neither is the Actions artifact protocol. `GitHubArtifactMetadata` and `Artifact` differ by a suffix and live one import line apart, and the first is used heavily while the second is used nowhere — which is exactly the shape of a collision that produces a confident wrong memory. **Recording it is the point of this section.**

### What that means for the design

The ruling stands and `Artifact` ships. Two consequences follow from the evidence rather than contradicting it:

- **The surface is ported conservatively, because there is no call site to shape it against.** Every other service in this package had its surface trimmed or grown against real consumer usage; this one cannot be, so it keeps the source shape rather than inventing a narrower one that a first real consumer would immediately outgrow.
- **It is the module most likely to reveal design debt at first real use**, and should be treated as provisional in a way the others are not. The first consumer to adopt it is the one whose feedback reshapes it.

```ts
export interface ArtifactShape {
  readonly upload: (name: string, files: ReadonlyArray<string>, rootDirectory: string,
                    options?: UploadOptions) => Effect.Effect<UploadResult, ArtifactError>;
  readonly list: (findBy?: FindBy) => Effect.Effect<ReadonlyArray<ArtifactItem>, ArtifactError>;
  readonly get: (name: string, findBy?: FindBy) =>
    Effect.Effect<Option.Option<ArtifactItem>, ArtifactError>;
  readonly download: (artifactId: number, options?: DownloadOptions, findBy?: FindBy) =>
    Effect.Effect<DownloadResult, ArtifactError>;
  readonly delete: (name: string, findBy?: FindBy) => Effect.Effect<ArtifactRef, ArtifactError>;
}
```

The one deliberate change from the source is **dropping the `Artifact` prefix from every member** — `uploadArtifact` on a service already called `Artifact` stutters at every call site (`artifact.uploadArtifact(...)`). `get` returning `Option` and `list` returning an array follow the kit's absent-is-not-an-error convention, which the source already had right.

`FindBy` (a cross-run lookup carrying `token`, `workflowRunId`, `repositoryOwner`, `repositoryName`) stays, but its `token: string` becomes `Redacted.Redacted<string>` — it is a credential, and this package has a [seam for declassifying one](#secrets-the-declassification-seam).

## `CacheKey`, and where `hashFiles` lives

`ActionCache`'s key ladder is consumer-visible logic that every consumer re-derives, so it becomes its own concept module: `hashFiles` over a compiled [`@effected/glob`](glob.md) pattern set, the primary-key/restore-key ladder, and branch-aware derivation.

**`hashFiles` homes here, and the reason is the `Crypto` gap.** The survey left the home open ("glob is pure in the kit; hashFiles needs FS+hash"). It cannot live in `glob` (pure — [R1](../effect-standards.md#dependency-policy) forbids the dependency and it does no IO) and it cannot live in `walker` (boundary — hashing is not traversal, and core exposes no digest, so it would need an external dependency and be pushed to integrated). Here it is free, because this package is integrated already and may use `node:crypto`.

Recorded escalation: **if a second, non-Actions consumer wants `hashFiles`, it moves** — either into a small `@effected/hash` package, or back into `walker` once core grows a digest contract. It is not a permanent home, it is the honest one today.

## Detached processes and the bare-pid guard

silk-runtime-action spawns a long-lived detached child in `main`, persists its pid through `ActionState`, and reaps it in `post`. Three pieces, all currently hand-rolled:

```ts
export class DetachedProcess {
  /** Spawn detached with stdio routed to a log file; returns the pid. */
  static readonly spawn: (options: DetachedSpawnOptions) =>
    Effect.Effect<ProcessId, DetachedProcessError>;
  /** Poll a predicate until it holds or the schedule is exhausted. */
  static readonly awaitReady: <E, R>(
    probe: Effect.Effect<boolean, E, R>,
    options?: ReadinessOptions,
  ) => Effect.Effect<void, E | ReadinessTimeout, R>;
  /** Signal a persisted pid. Refuses a non-positive pid, typed. */
  static readonly reap: (pid: ProcessId, signal?: NodeJS.Signals) =>
    Effect.Effect<boolean, DetachedProcessError>;
}
```

**The bare-pid guard is why reaping lives here** ([decisions log](../../plans/2026-07-25-github-split-decisions-log.md) decision 10): killing crosses a process boundary, no `ChildProcess` handle survives the phase boundary, and `node:process.kill` is required — which a boundary package may not import. The guard itself is the load-bearing part: **`process.kill(0)` signals the entire process group and `process.kill(-1)` signals every process the user owns.** A pid round-tripped through `GITHUB_STATE` that decodes to `0` — an absent key, a truncated file, a `Number("")` — would, unguarded, kill the runner. So `reap` refuses any `pid <= 0` as a typed failure, and `ProcessId` is validated on the way *out* of `ActionState` as well as on the way in. This guard sits beside the `ActionState` that can produce the bad value, which is the whole reason it is here rather than in `commands`.

`awaitReady` is the spec's missing "poll-until-domain-predicate" (spec §7): silk-router-action hand-rolls it with an `Effect.suspend` footgun explained in a comment, and silk-runtime-action hand-rolls a second copy as `fetch` + `Schedule.spaced(150ms) × 40`.

### The fd-routing gap

[Decision 11](../../plans/2026-07-25-github-split-decisions-log.md) records the upstream limitation: core cannot route a detached child's stdio to a **file descriptor** — `CommandOptions.stdout` maps to an in-process pipe, which defeats detachment, and `additionalFds` are pipes too.

**v1 answer: this package does the fd-level spawn itself**, on `node:child_process` with `stdio: ["ignore", fd, fd]`, because it is the one package permitted to. That keeps `@effected/commands` clean of a Node-specific escape hatch and gives the consumer a working detached log today. The upstream issue stays a candidate; if core grows fd routing, `DetachedProcess.spawn` becomes a thin adapter over it and the `node:child_process` import disappears. Recorded so the eventual removal is a known follow-up rather than an archaeology exercise.

## Errors

One typed error per concept module, `Schema.TaggedErrorClass`, sized to what callers actually read — the spec's §7 finding that `GitHubClientError` demanded five mandatory fields while readers used one or two applies here too.

`ActionEnvironmentError`, `ActionStateError`, `ActionOutputError`, `ActionCacheError`, `ArtifactError`, `ToolInstallerError`, `OidcTokenError`, `BlobStoreError`, `BlobEnvelopeError`, `DetachedProcessError`. Each carries a `reason` literal union plus the one or two fields a caller branches on, with ergonomic statics for construction, and foreign failures wrapped with `cause: Schema.Defect()` rather than stringified.

`ActionInputError` does **not** survive: input failures are `ConfigError` now, because inputs are `Config`-backed. That is one fewer error class and a strictly better message, since `ConfigError` names the missing key.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards) and the skill's uniform-coverage rule:

- **Named `Effect.fn` spans on every public fallible member** of every service — uniformly, not selectively. Partial coverage reads as signal to whoever is tracing.
- **Annotations are stable identifiers only**: `key` for cache and blob operations, `tool`/`version` for the installer, `pid` for detached processes, `name` for inputs and outputs. **Never a value, never a secret, never a payload** — this package handles tokens by definition, and a span annotation is the easiest place to leak one.
- **`WorkflowCommand` and `BlobEnvelope` are pure and carry no spans**, per the Result-parity rule: the sync primitive is not an Effect and does not get instrumented.
- The package emits `Effect.log*` and ships the `Logger` that renders those as workflow commands. It composes **no** OpenTelemetry — an action that wants OTel composes it in its own entrypoint.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`. **No `./testing` subpath**, and none of the source package's nine `*Test` doubles is ported as-is.

- **Every service ships `makeTest(overrides?: Partial<Shape>)` + `layerTest(overrides?)`**, unstubbed members dying loudly with a message naming the member. This is the direct fix for the spec's §2.2 defect — `CommandRunnerTest` returned **exit 0 for unregistered commands**, and two silk-release-action tests are green on that documented lie.
- **Honest-default exceptions, recorded LocalExec-style.** Three doubles get real defaults rather than dying, because a dying default would make them useless: `ActionEnvironmentTest` seeds the twelve `GITHUB_*` context variables (the spec counts this block **duplicated six times byte-identically** for want of a defaults-plus-overrides form), `ActionLoggerTest` defaults to silent, and `DryRunTest` defaults to `isDryRun: true` — the safe direction. Every other member dies.
- **`ActionState` round-trips through a real `GITHUB_STATE` file** in a temp dir, because the phase boundary is the thing under test and an in-memory double asserts the double.
- **`BlobEnvelope` gets pure tests and a property**: encode/decode round-trips arbitrary metadata and bodies, a truncated frame fails `truncated` rather than throwing, a random byte array fails `notAnEnvelope`, and a bumped version byte fails `unsupportedVersion`. This is the module where a counterexample is a corrupted cache entry, so it earns a property.
- **The `GitHubToken` member-usage table is executable**: a `layerTest` supplying exactly the documented members satisfies each function, and one supplying fewer fails.
- **The bare-pid guard gets its own test with a control**: `reap(0)` and `reap(-1)` fail typed *without* calling `process.kill`, proven by a spy that must record zero calls — the assertion has to be that the kill did not happen, not merely that the effect failed.
- **Bundle reachability with a control**, per [above](#bundle-reachability-confining-azure).
- **Integration**, opt-in and skipped-not-green without credentials: a real Actions-cache round trip and a real S3-compatible round trip against MinIO.
- **Mutate the edges before declaring green** — flip the pid guard's comparison, the envelope's magic bytes, the `INPUT_` name mangling and the `withEnv` scoping, and confirm the suite goes red.

## Shared vocabulary with `@effected/github`

Per program decision 9, recorded per concept:

- **`RepoRef`, `InstallationToken`, `BotIdentity`, `GitHubClient` — canonical in `github`, consumed here.** This package depends on `github` (program decision 4), so duplicating them is the failure mode decision 9 warns about. `ActionEnvironment.repo` returns `github`'s `RepoRef`, and `GitHubToken` persists `github`'s `InstallationToken` — which is encodable precisely so this package can persist it.
- **`GitHubContext` / `RunnerContext` — canonical here.** They describe the *runner*, not the API: `runId`, `runAttempt`, `workflow`, `job`, `runnerOs`, `runnerTemp`. `github` has no use for them and taking them there would invert the dependency.
- **The workflow-command protocol is canonical here and duplicated nowhere.** It is the seam `github` deliberately dropped when `silentOctokitLog` died.

## Deliberately not ported

- **The `./testing` subpath and all nine behavior-reimplementing doubles**, per the program's standing rule and spec §2.2.
- **`CommandRunner`** — superseded by [`@effected/commands`](commands.md). This package consumes it; the survey's `CommandRunner` tag disappears.
- **`Glob`** — the kit owns [`@effected/glob`](glob.md); only `hashFiles` lands here, and [conditionally](#cachekey-and-where-hashfiles-lives).
- **`ConfigLoader`** — a file loader that dissolves into [`@effected/config-file`](config-file.md); `ActionEnvironment` is the env service and is what stays (spec §5).
- **`Attest`, `Sbom`, `SigstoreSigner`** — Phase 4, and their `@cyclonedx/*` and `@sigstore/*` dependencies go with them.
- **`PackagePublish`, `NpmRegistry`** — Phase 5, with token masking hoisted to the caller, which removes the duplicate sub-provide silk-release-action needs today (spec §5).
- **`WorkspaceDetector`, `PackageManagerAdapter`, `ChangesetAnalyzer`** — the kit already owns all three.
- **`GithubMarkdown`** — a string builder with no Actions coupling; it belongs to whichever consumer wants it, or to `@effected/markdown` if a second one does.
- **`ActionInputError`** — dissolved into `ConfigError`.

## Settled at the Phase 3 checkpoint

Ruled 2026-07-25; recorded so they are not reopened.

1. **`Artifact` ships in v1.** See [the Artifact section](#artifact--ships-in-v1-and-the-name-collision-that-nearly-sank-it) for the search evidence and the `GitHubArtifactMetadata` name collision behind it. The surface is ported conservatively and treated as provisional until a first real consumer reshapes it.
2. **`ToolInstaller`'s possible `@effected/runtimes` edge is an implementation-time call.** The overlap may be shallow — `runtimes` resolves *versions*, `ToolInstaller` installs *files* — so the decision is made against the consumer's actual runtime descriptors, not in the abstract. The edge is free under [R3](../effect-standards.md#dependency-policy) if it is taken.
3. **`#144`'s `writeDirAtomic` is an implementation-time call.** Extraction into a tool-cache directory is a stage-then-swap shape, so the watch item probably fires — but it is confirmed against the extraction path when that path is written, not assumed now.
4. **How much of `Action.run`'s failure rendering survives is an implementation-time call.** The source formats causes, strips stack frames and emits an Effect span trace as `::debug::`. It is genuinely useful, genuinely fiddly, and the one part of the port with no test coverage today — so whatever survives arrives with tests.
