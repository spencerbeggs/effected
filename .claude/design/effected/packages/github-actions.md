---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 100
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

**Core `Crypto` covers digests but not HMAC.** Corrected against `.repos/effect` at beta.101 (2026-07-25): `effect/Crypto` exposes random primitives, UUIDs and SHA digests (`Crypto.digest`, `DigestAlgorithm` SHA-1/256/384/512) — but no HMAC, signing or key derivation. So `hashFiles`, the S3 SigV4 signer and the cache-key derivation all use `node:crypto`, and **no `@aws-sdk/*` dependency is needed for SigV4** — the source package already proves this with a ~100-line `internal/sigv4.ts` over `node:crypto`. Recorded because "put it on core `Crypto`" is the obvious wrong guess.

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
| `src/BlobStore.githubCache.ts` | `GitHubCacheBlobStore` — the Actions-cache Twirp v2 backend | `@azure/storage-blob` |
| `src/BlobTransfer.ts` | **pure**: the transport seam the three Azure modules take as an argument | — |
| `src/ToolInstaller.ts` | download / extract / cache a toolchain | — |
| `src/DetachedProcess.ts` | detached spawn, readiness probe, the bare-pid reap guard | `node:child_process` |
| `src/internal/` | SigV4, the Twirp client, the results-backend reader | — |

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

**`ActionsConfigProvider` is subsumed, and the subsumption must be confirmed rather than assumed.** The source package exports a bare `ConfigProvider` that maps a config path to `INPUT_<NAME>`; two silk-release-action test files install it directly. Everything it does is folded into this module — the provider becomes an implementation detail behind the accessors, which is what removes the opportunity to spell a variable name wrongly. **At implementation, diff its behavior against the accessors before deleting it** (empty-string-is-absent, the space-to-underscore rule, and the fact that dashes are *not* translated), and record the result here. A subsumption claim that was never checked is how a footgun survives a port.

**Implementation note (v4):** there is no `Effect.withConfigProvider`. `ConfigProvider.ConfigProvider` is a `Context.Reference` (verified `ConfigProvider.ts:296`), so installing a provider — in the accessors' tests or in `Action.run` — is `Effect.provideService(effect, ConfigProvider.ConfigProvider, provider)`. The v3 name is the first thing a porter will reach for.

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

**`hashFiles` homes here, and the reason is the `Crypto` gap.** The survey left the home open ("glob is pure in the kit; hashFiles needs FS+hash"). It cannot live in `glob` (pure — [R1](../effect-standards.md#dependency-policy) forbids the dependency and it does no IO) and it cannot live in `walker` (boundary — hashing is not traversal; core does expose `Crypto.digest`, but the restore-key derivation also wants the HMAC-adjacent machinery this package already carries). Here it is free, because this package is integrated already and may use `node:crypto`.

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

## `OidcTokenIssuer`, and why the claims are decoded but not verified

Lives here rather than in `@effected/sbom` because it reads `ACTIONS_ID_TOKEN_REQUEST_TOKEN` / `ACTIONS_ID_TOKEN_REQUEST_URL`, which exist only when a workflow declares `id-token: write` (spec §5).

```ts
export interface OidcTokenIssuerShape {
  readonly token: (audience?: string) => Effect.Effect<Redacted.Redacted<string>, OidcTokenError>;
  /** The token's claims, decoded. */
  readonly claims: (audience?: string) => Effect.Effect<OidcClaims, OidcTokenError>;
}
```

**Decoded claims are a typed value on the surface, not a nullable hand-parse at the call site.** This is the fix for [spec §2.3](../../plans/2026-07-25-github-split-master.md), the structurally-untestable provenance path: the source's `OidcTokenIssuerTest` returns a synthetic non-JWT, so a consumer's `decodeJwtClaims` yields `null`, so `attest.provenance` is *never reached* — four separate comments in silk-release-action apologize for it. With claims on the issuer's surface, a test double returns **real decodable claims** and the provenance path becomes reachable. `@effected/sbom` consumes it as `claims()` → `SlsaProvenance.forGitHubWorkflow`, so this is the seam between the two packages.

**The decode deliberately does NOT verify the JWT signature, and that is not an oversight.** Three reasons, recorded so a future agent does not "fix" it:

1. The token comes from the runner's **own token-service endpoint over TLS** — the transport is the trust boundary, and the process asking for the token is the process that received it.
2. The claims populate a **provenance predicate**, not a trust decision. Nothing branches on them for authorization; they are recorded as attested facts about the workflow that ran.
3. Verifying would require a **JWKS fetch**, turning a pure decode into a network call — which would make the claims surface non-pure, untestable without a fixture server, and dependent on GitHub's key endpoint being reachable at attestation time.

If a consumer ever needs a *verified* token, that is a different operation with a different name and a different error channel, not an option on this one.

## Errors

**Audit every ported error channel for whether it can actually fire.** A general finding from the source read: the package has at least two error channels that are structurally unreachable — a pure body wrapped in `Effect.try`, so the `catch` arm is dead. A channel that cannot fire is worse than no channel: it forces every caller to handle a case that does not exist, and it makes the type a lie about the operation. When porting a member, either demonstrate the failure path with a test or delete it from the signature.

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
- **`Artifact`'s `FindBy` (the cross-run / cross-repo lookup)** — RULED out of v1 (2026-07-25). **A parameter whose only behavior has ever been a typed refusal is a ported lie:** every path through `findBy` in the source package fails with "not yet implemented", so porting it would ship a surface that answers no question. `Artifact` is already [provisional by ruling](#artifact--ships-in-v1-and-the-name-collision-that-nearly-sank-it), and adding the parameter back when a consumer produces a real cross-run lookup is **additive**, whereas shipping it and later removing it would not be. If it returns, the design doc's sketch is the shape it takes: `{ token, workflowRunId, repositoryOwner, repositoryName }` with **`token: Redacted.Redacted<string>`** rather than the source's `string`, because it is a credential and this package has a seam for declassifying one.

## As built — complete (2026-07-25)

Every module in the map is built against `effect@4.0.0-beta.101`: **298 tests**, `tsc --noEmit` clean, biome clean, and a **zero-warning build** — 27 suppressed `_base` entries and nothing else.

It arrived over three sessions. The first two produced fourteen units — `WorkflowCommand`, `ActionEnvironment`, `ActionOutputs`, `ActionState`, `Secret`, `BlobEnvelope`, `ActionInput`, `ActionLogger`, `DryRun`, `CacheKey`, `DetachedProcess`, `OidcTokenIssuer`, `ToolInstaller`, `BlobStore` (+ the SigV4 signer) — at 213 tests. The third closed it: `internal/twirp`, `internal/actionsResults`, `BlobTransfer`, `BlobStore.githubCache`, `ActionCache`, `Artifact`, `CacheKey.matchingFiles`/`hashMatching`, the Azure reachability suite, `GitHubToken`, and `Action`/`ActionRuntime`.

Both dependency questions are closed: **`@effected/glob` is taken** (the recommended option below), and `@azure/storage-blob` is confined to three modules and measured.

### Deltas from the design

- **`BlobEnvelope`'s magic is `"EFBS"`, not `"EBS1"`.** A version digit inside the magic is a second version channel, and two version channels can disagree. The magic identifies the *family*; the version byte identifies the *revision*. Approved 2026-07-25.
- **`ActionEnvironment.repo` is deferred to milestone (d)**, because it returns `@effected/github`'s `RepoRef` and (a) is deliberately github-independent. `github` (the context) carries `repository` as a string, so nothing is blocked meanwhile.
- **`ActionOutputs.setFailed` emits the annotation but does not set the exit code.** That belongs to `Action.run`, so an action that reports a failure and then recovers is not doomed by a side effect it cannot undo.
- **Runner-file delimiters are derived, not random.** GitHub's toolkit uses a random UUID and accepts a collision chance; deriving (`EFFECTED_EOF`, extended with `_` until absent from the value) makes collision *impossible* rather than improbable, needs no `Crypto` in `R`, and is deterministic under test. A value containing the delimiter would otherwise terminate its block early — a value-controlled injection into the runner's own file.
- **`ActionsConfigProvider` subsumption CONFIRMED**, not assumed. Diffed against `runtime/ActionsConfigProvider.ts`: path joined with `_`, spaces → `_`, uppercased, empty-string-is-absent. All four preserved, and a test resolves each input against *only* its expected variable so the derivation is proven rather than restated. Dashes are **not** translated, which is the whole point.
- **`ActionLogger.layerSilent` is a constant, not the `layerSilent()` the design writes.** A no-arg layer factory mints a fresh layer per call and defeats memoization for nothing.
- **Log annotations use the readable `AnnotationProperties` vocabulary** (`startLine`, `startColumn`), not v3's wire names (`line`, `col`). `ActionLogger.annotated(properties, effect)` is how they are set, so a caller never spells an annotation key — the same reasoning that makes `ActionInput` safe.
- **`withBuffer` reads step-debug through `ActionEnvironment.isDebug`**, not `process.env.RUNNER_DEBUG`; `ActionLogger.layer` therefore requires `ActionEnvironment`.
- **`DryRun.guard`'s fallback is required, not optional.** A mutation whose result the caller uses must say what a rehearsal produces instead, and the type is the place to force that.
- **`DetachedProcess`'s `ReadinessTimeout` is folded into `DetachedProcessError`** as `reason: "notReady"`, per one typed error per concept module.
- **`ProcessId` is core's brand.** See [the vocabulary correction](#processid-belongs-to-core).
- **`ToolInstaller.download` is core `HttpClient`, not `node:https`**, and streams to disk rather than buffering. `extractTar`/`extractZip` require core `ChildProcessSpawner` in `R` — no spawner backend here, per the commands invariant. The Windows branch reads `RUNNER_OS`, not `process.platform`.
- **`Secret` gained `forSigning`.** See [the two invariant catches](#the-declassification-invariant-earned-its-keep-twice).
- **The GitHub-cache backend is `GitHubCacheBlobStore.layer`, not `BlobStore.layerGitHubCache`.** Putting the static on the service class would make `@azure/storage-blob` reachable from every module that reads a blob — the layer-static-belongs-to-the-module-owning-the-dependency rule (`GitHubApp.clientLayer`'s precedent), applied here for a confinement reason rather than a stylistic one.
- **The three Azure modules take their transport as an argument.** `FileBlobTransfer` / `DataBlobTransfer` + `BlobTransferError`, with `layerWith(transfer)` beside each `layer`. See [the transport seam](#the-transport-seam-and-what-it-buys).
- **`Artifact` drops `FindBy`** — approved 2026-07-25 and recorded in [deliberately not ported](#deliberately-not-ported), where the reasoning and the shape it would return in belong. The rest of the surface is ported conservatively per the ruling, with the stuttering `Artifact` prefix dropped from every member.
- **`ActionCache.save`/`restore` accept a `CacheKey` as well as a `string`,** and a `CacheKey` supplies its own restore-key ladder. The ladder is the part every consumer re-derives and gets subtly wrong; passing the key passes the ladder with it.
- **`ActionRuntime.layer` excludes the cache, artifact and blob services.** See [the runtime's exclusion](#actionruntime-excludes-the-heavy-three).
- **`ActionRuntime` does not install `ActionInput`'s `ConfigProvider`.** See [the probe that removed it](#the-config-provider-the-runtime-does-not-install).
- **`ActionEnvironment.repo` did not land.** It would have returned `@effected/github`'s `RepoRef`, putting an edge to `github` — and therefore octokit — on the graph of the lightest module in the package, which currently reaches `effect` and nothing else. `GitHubContext.repository` is already the `owner/repo` string and `RepoRef.parseResult` is a pure sync call, so a consumer that wants the coordinate spends one line for it. Recorded as a deliberate non-port rather than an omission.

### `CacheKey`, shipped in two halves

**Built:** `CacheKey` as a `Schema.Class` over validated segments with a derived `restoreKeys` ladder, `of`, `forBranch`, and `hashFiles(files)` over core `FileSystem` + `node:crypto`.

Three properties earned their tests, and each is a way the obvious implementation is wrong:

- **Every rung ends in the separator.** GitHub matches restore keys as bare prefixes, so `Linux-pnpm` would also match `Linux-pnpmx-…` from an unrelated cache.
- **A one-segment key gets no rung at all.** An empty prefix matches every cache in the repository.
- **`forBranch` orders `os → scope → branch → hash`**, so the first fallback stays on the branch. Reversed, a feature branch warms itself from `main` and never finds its own cache.

`hashFiles` is **byte-compatible with `@actions/glob`**: sorted, de-duplicated, and each file's SHA-256 fed into the accumulator as **binary, not hex**. A hex-fed accumulator produces a perfectly plausible digest that never matches a cache entry written by any other action; the test pins the digest as a literal and the wrong-way value (`e11ab1a1…`) is what the mutant produced.

**Built as two statics, not one.** `CacheKey.matchingFiles({ workspace, patterns })` answers with the sorted absolute paths a pattern set matches; `CacheKey.hashMatching` is that fed to `hashFiles`. Splitting them is what lets a caller reuse the discovery — `ActionCache.save` takes literal paths — and it is the pairing every consumer otherwise writes by hand, whose two halves have to agree about ordering and about what counts as a file.

Two behaviors earned tests, and one of them is a real trap: **candidates are matched by their path relative to the workspace** (which is what makes "never hash a file outside the workspace" structural rather than remembered), and **directories are excluded by an explicit `stat`**. A directory called `notes.txt` matches `**/*.txt` and is not a file; without the check it reaches `hashFiles`, which fails on the read — so the difference is a working cache key versus a failing action. The mutant that loosens the check is what proves the test discriminates.

A glob that will not compile is a typed `CacheKeyError { reason: "badPattern" }` rather than a `GlobPatternError` leaking from a dependency onto this package's surface — which is why `CacheKeyError.path` became `optionalKey` and gained a sibling `pattern`.

The doc originally said "`hashFiles` over a compiled `@effected/glob` pattern set". Checking the real surfaces changes the shape of that sentence: **`@effected/glob` is a matcher, not a walker** — pure string→predicate by construction (pure tier), so it cannot supply file *discovery*. So the module is two halves, not one:

- **The walk is core `FileSystem.readDirectory(path, { recursive: true })`**, and it is the better half of the deal: it makes the whole of `hashMatching` testable through `FileSystem.layerNoop`, with no temp directory and no real IO.
- **The matching is `@effected/glob`'s `GlobSet`**, taken as a `workspace:~` dependency (**approved and installed 2026-07-25**; free under R3). The alternative — `node:fs.globSync`, as the source package uses — was rejected on a correctness argument rather than a weight one: it welds discovery and matching into one non-stubbable call, and **node's glob dialect is not minimatch**, which is what `@actions/glob` uses. A dialect divergence surfaces as a *silent cache-key difference* from every other action in the same workflow — a permanent miss that reports nothing, which is the worst failure mode a cache key has.

Walking from the workspace root also makes v3's "skip files outside the workspace" rule **structural** rather than a remembered check.

The three byte-compatibility details each earn their own test, because a cache written by an existing `actions/cache` step must stay hittable: sorted absolute paths, the per-file digest fed to the accumulator as **binary not hex**, and files outside the workspace root skipped.

### `#144` is ruled: stage then swap

**The watch item fires.** `ToolInstaller.cacheDir`/`cacheFile` stage into a temp directory **under the cache root** and `rename` into place. Two invariants, both tested, and both confirmed by mutating the naive "make the destination, then copy into it" implementation back in — it fails both:

- a failed install leaves **nothing** at the cache path. The naive form leaves an empty directory, and `find` reports an empty directory as a **hit**, so every later run uses a tool that is not there and never re-downloads it;
- a re-install **replaces** rather than merges, so the previous version's files do not survive inside the new one.

The staging directory lives under the cache root deliberately: a rename across filesystems is not atomic and often not permitted, so `os.tmpdir()` would silently degrade the guarantee to a copy.

### `ProcessId` belongs to core

Caught while reading `unstable/process` for `ToolInstaller`: **core already owns `ProcessId`** (`ChildProcessSpawner`), so declaring one here was the re-declaring-a-core-concept half of the commands invariant. It now decodes to *core's* brand and `DetachedProcess.spawn` returns core's type.

What justifies the module keeping a `ProcessId` export is what core does **not** have: a *validating* constructor. Core's is `Brand.nominal`, which applies no runtime check, so `ChildProcessSpawner.ProcessId(0)` succeeds. That is right for a pid the spawner just produced and wrong for one that has been through `GITHUB_STATE` as text. Verified with a type-level probe **and a control that fails to compile** (annotating the decode as `ExitCode` errors), so "interchangeable with core's" is a checked claim rather than a comment.

### The declassification invariant earned its keep, twice

The structural test over `src/` is not ceremony — it caught two real leaks that a review would plausibly have waved through.

1. **`OidcTokenIssuer.claims` unwrapped its own token.** The obvious implementation calls `token()` then `Redacted.value`s it to decode. Restructured instead: a private `issue()` returns the raw JWT, `token` wraps it, `claims` reads it, and `Redacted.value` appears nowhere in the module.
2. **SigV4 needs the raw secret for its HMAC.** Rather than granting an exception, `Secret.forSigning` was added — the seam already existed for exactly this shape — so `BlobStore.layerS3` requires `ActionOutputs` and **masks both credentials once at layer construction**, not per request. Worth having even though the key is never written anywhere: a signing key leaks through something nobody audited (a debug log of outgoing headers, a serialized error, a stack trace holding the closure), and the runner's filter redacts all of those.

**And the test itself had a phantom-edge bug**, found the same way the reachability walkers found theirs: a raw text scan reads TSDoc as code, so a module whose comment *explains* that it does not unwrap a secret was reported as unwrapping one. It now strips comments first, keeps its non-empty control, and has a third test for the stripper — which is load-bearing once the scan depends on it, and a blinded scan is a silent false green.

### SigV4 is verified against AWS's published values, not against itself

The signer was first checked against a remembered "GET Object" signature (`f0e8bdb8…`). It did not match — the situation where **you cannot tell which side is wrong**. Climbing to values AWS actually publishes settled it: the canonical-request hash `7344ae5b…` and the signing-key derivation `f4780e2d…` both reproduce exactly, so the algorithm is right and the remembered constant belonged to a different example.

`canonicalize` and `signingKey` are exported from the internal module for exactly this reason — so the fixture is an **external** oracle rather than this implementation's own output. Pinning the computed signature would have been a regression test that ratified whatever was written.

### v4 API corrections found while building

1. **`Effect.withConfigProvider` does not exist.** `ConfigProvider.ConfigProvider` is a `Context.Reference` (`ConfigProvider.ts:296`); override with `Effect.provideService`, or install with `ConfigProvider.layer(provider)`.
2. **`FiberRef` does not exist.** `Context.Reference` (`Context.ts:1335`) is the v4 spelling, and it is what makes `withEnv` and the log buffer fiber-local.
3. **Core `Crypto` has digests but no HMAC** (corrected 2026-07-25 — an earlier note here claimed RNG-only). SigV4's signing-key chain is HMAC, so it needs `node:crypto` regardless; `hashFiles` could use `Crypto.digest` but shares `node:crypto` since this package is licensed for it.
4. **`Config.withDefault` reads the *issue*, not the combinator.** See the `ActionInput` defect below — this is the sharpest of the four.
5. `Duration.Input`, not `Duration.DurationInput`; `Effect.sleep` takes it directly. A branded `Schema` has no `makeUnsafe`.

### A latent defect in `ActionInput`, found by the error-channel audit

`ActionInput`'s `configError` built `SchemaIssue.InvalidValue(Option.none(), …)`. `Config.withDefault` and `Config.option` fall back for **missing data only**, and `isMissingDataOnly` (`Config.ts:304`) classifies an `InvalidValue` whose `actual` is `None` **as missing**. So every validation failure in `boolean`, `list`, `pairs` and `schema` was **silently swallowed by any default**: `dry-run: yes` resolved to `false`, and the action would have performed every mutation the workflow author meant to rehearse.

Fixed by carrying the offending value on the issue. Mutation-verified: reverting to `Option.none()` fails the new `DryRun` test with the literal message `false` — the swallowed default itself. **This is a v4 semantics trap, not a typo**: nothing about `withDefault`'s signature suggests the fallback depends on how the failure was *constructed*.

### Testing notes the successor needs

- **Interleaving tests must use `Latch`, never `Effect.sleep`.** Under `it.effect`'s virtual `TestClock` a sleep hangs to the 5000ms vitest timeout.
- **The two-latch requirement is load-bearing.** A single-latch interleaving *passed against a deliberately-wrong global save/restore implementation*, because save/restore is LIFO-correct whenever two overrides nest properly. The discriminating order forces one fiber to read **while the other's override is still applied and unrestored**. `ActionLogger`'s buffering test uses three latches for the same reason.
- **A spy on a process global must be released on the failure path.** `vi.spyOn(process, "kill")` restored in a `try`/`finally` inside `Effect.gen` **leaks when an assertion fails**, because the failure leaves through the error channel. Under one mutant two tests went red and the second was pure pollution — a false red; by the same mechanism a leaked spy produces a false *green* in a later test. `Effect.acquireUseRelease` is the fix.
- **`unhandledErrors` catches what assertions cannot.** A `ChildProcess` with no `error` listener re-throws the event, so a missing binary would have reported `spawnFailed` correctly *and then killed the action*. All 15 tests were green while that was live; only vitest-agent's `unhandledErrors` field showed it.
- **Real IO where the claim is about the filesystem.** `ToolInstaller` tests run under `NodeServices.layer` with real `tar`: stage-then-swap is a statement about what the filesystem contains after a partial failure, and an in-memory double would only assert the double.
- **A semantics-preserving mutant is reported, not papered over.** `Buffer.from(x, "base64url")` → `"base64"` changes nothing, because Node's plain base64 decoder accepts the url alphabet and unpadded input (probed, with a control producing `-` and `_`). The strict spelling stays because `atob` is not forgiving, and a test now exercises the alphabet — but no honest test kills that mutant.
- Mutants killed so far: the `withEnv` global-mutation mutant; the dash-translating `inputVariable` mutant; the `ActionLogger` buffer-as-global mutant, its Warn/Error threshold, its `RUNNER_DEBUG` bypass and its group flush; the `ActionInput` swallowed-default mutant; `CacheKey`'s hex-fed digest, catch-everything ladder rung and dropped sort; the `pid < 0` guard; the `?audience=` join; and the naive tool-cache install (two invariants).

### The transport seam, and what it buys

The three Azure-touching modules take their transport as an argument — `FileBlobTransfer` (whole files, for the cache and artifacts), `DataBlobTransfer` (buffers, for the blob store) — with `layerWith(transfer)` beside each `layer`, and the real Azure client wired into `layer`.

The reasoning is the same one that made `@effected/sbom` drive the **real** `DSSEBundleBuilder` through a stub signer: **what this package owns is the protocol, and the protocol is not the transport.** The RPC sequence, the conflict handling, the version derivation, the retry policy and the envelope framing are all on this side of the pre-signed URL; the `PUT` is not. Taking the transport as an argument is what makes the first group *execute* in a test rather than be described by one — the cache suite tars real files with real `tar`, deletes them, and restores them, which is a claim about the filesystem that no in-memory double could make.

It also settles a duplication question that looks like sloppiness and is not: **each of the three carries its own ~15-line Azure adapter.** Hoisting them into a shared `internal/azureTransfer.ts` is exactly the move the confinement rule forbids, and the reachability suite asserts the resulting edge sets exactly — including that `internal/twirp.ts` reaches `effect` and `effect/unstable/http` and nothing else.

The same seam is the recorded way to run the opt-in integration tests: point the real protocol at a local blob endpoint.

### The Twirp client decides retryability structurally

`internal/twirp.ts` owns one RPC, one conflict sentinel and one retry policy, and **applies the retry itself** so no protocol can ship without it. Its failure value is structural — `transport` / `status` / `malformed`, with the status when there was one — rather than the predecessor's formatted string, which was tested for the substrings `"HTTP 503"` and `"ECONNRESET"`. Under that scheme rewording a message was a silent policy change.

Two smaller corrections travelled with it:

- **Both field spellings are read** (`signedUploadUrl` *and* `signed_upload_url`). The backend is an internal GitHub protocol whose two halves disagree; the predecessor's cache layer read snake_case only. The failure mode of guessing wrong is "the cache silently never hits", which is the hardest cache failure to notice.
- **A non-retryable failure never sleeps**, which is what keeps every ordinary failure test clock-free. Only the one test that proves a `503` *is* retried needs a virtual clock.

### The results backend is only reachable from a `uses:` step

`ACTIONS_RESULTS_URL` and `ACTIONS_RUNTIME_TOKEN` are injected into action execution contexts and **not** into `run:` shell steps, so identical code works from a bundled action and fails when a workflow invokes it with `node ./main.js`. All three services report that as `misconfigured` **naming the absent variable**, because nothing else in the environment distinguishes the two cases.

They read the variables **per call, through `ActionEnvironment`** — not at layer construction. Resolving at construction would make merely *composing* the layer fail outside Actions, including for an action that never touches the cache. What *is* resolved once at construction is the `ActionEnvironment` service itself, so every member's `R` stays `never` (the same fix `ActionEnvironment.payload` got).

**The runtime token is never declassified.** It arrives from the environment as plaintext, is wrapped in `Redacted` at the read, and leaves only through `HttpClientRequest.bearerToken` — which accepts a `Redacted` directly (verified in the vendored source). The artifact backend ids are decoded from the plaintext *before* the wrap. So the declassification seam needed no new member and `Redacted.value` still appears only in `Secret.ts`.

### `ActionRuntime` excludes the heavy three

`ActionRuntime.layer` provides `ActionEnvironment`, `ActionLogger` (plus the workflow-command `Logger`), `ActionOutputs`, `ActionState`, `NodeServices` and an `HttpClient`. It deliberately does **not** provide `ActionCache`, `Artifact` or the GitHub-cache `BlobStore`.

Folding them in would put `@azure/storage-blob` in the bundle of every action that merely sets an output — which is the confinement invariant restated as a composition decision rather than an import rule. Their requirements are all satisfied by the runtime, so a consumer that wants one writes `Action.run(program, { layer: ActionCache.layer })` and nothing else; `ActionRunOptions.layer` is typed `Layer<R, never, ActionServices>` precisely so that compiles with no further wiring. The reachability suite asserts `Action.ts` reaches `@effect/platform-node`, `effect` and `effect/unstable/http` — and no more.

The wiring inside is `provideMerge`, not a flat `mergeAll`: `ActionState` needs `ActionOutputs` (it masks before it persists) and `ActionOutputs` needs `ActionEnvironment`. Merged as siblings they never see each other and the layer does not build.

### `Action.run`'s layer option is NOT self-contained — the audit's Case 3, discharged

The [fluency audit](../consumers/fluency-audit.md)'s Case 3 was left PROVISIONAL on this module, with three things for the closer to confirm. All three, answered:

**1. Does `Action.run` still demand a self-contained layer? No — and the audit re-scores upward.** `ActionRunOptions.layer` is typed `Layer.Layer<R, never, ActionServices>`: the caller's layer may require **anything the runtime provides**, which is the platform, the HTTP client and every runner service. The composition in the audit therefore loses its own `platform` provide as well as its sub-provides — the platform is provided once, at the boundary, by `Action.run` itself.

The predecessor's option was `Layer<R, never, never>`, and that single `never` is what produced the five-line comment in `silk-release-action/src/main.ts` explaining why a requirement "could not be allowed to travel upward". It could; the type just said otherwise.

**2. Where does the App token enter in `main`?** Exactly where the audit assumed: `GitHubToken.clientLayer()` reads the token an earlier phase persisted in `ActionState` and builds `GitHubClient.layerFromToken` from it. Not through `GitHubApp` — that path links a JWT signer and needs the private key, which `main` neither has nor should have. The `Redacted` never leaves the bridge as a string.

**3. Nothing reintroduces an `ActionOutputs` sub-provide for masking** — asserted, not promised. `__test__/Action.test.ts` runs a `PackagePublish`-shaped layer that requires **both** `FileSystem` (the platform) and `ActionOutputs` (to mask), passes it straight to `Action.run` with no sub-provide, and asserts that `::add-mask::s3cret` reaches the runner. Narrowing the option back to `Layer<R, never, never>` makes that test **fail to compile**, which is the mutant that proves it discriminates.

The masking hoist itself is upstream and survives untouched: nothing in this package requires `ActionOutputs` on a consumer's behalf, and `Secret.forRunnerFile` declares the requirement in its own `R` where the boundary satisfies it once.

### The config provider the runtime does not install

`ActionRuntime` was first written with `ActionInput.layer()` in it, on the reasonable assumption that the `INPUT_` provider is what makes inputs resolve. **A mutant removing it survived**, so the assumption was probed rather than defended, at beta.101 from inside the package:

- the ambient provider **is** environment-backed and resolves `INPUT_MY-GREETING` exactly as this one does;
- it already reads `""` as **absent**, so `Config.withDefault` fires for an input the workflow omitted — the behavior that motivated the custom provider in the first place;
- it does **not** uppercase a config path, which is the one axis on which the two differ.

That last point turns the line from redundant into actively costly: installing this provider uppercases *every* config path in the program, silently changing the resolution of any `Config` a consumer wrote that is not an input. So the line came out rather than being documented as load-bearing. `ActionInput.layer(env)` stays exported for what it was built for — resolving inputs from an explicit record in a test, without mutating the process — and the end-to-end omitted-input test stays as the thing that fails if core's empty-string semantics ever move, with reinstating the line as the recorded fix.

The general lesson is worth more than the line: **a surviving mutant is a question about the code, not about the test.** The answer here was that the code was unnecessary.

Every finding above still holds — but the conclusion drawn from them ("install nothing") was superseded the same week by a ruling, recorded next. What changed is not the probe; it is that a **different** provider went in, one that does not have the uppercasing cost the probe found.

### The config provider the runtime DOES install — RULED (2026-07-25)

A live action shipped a **false green**: every bare `Config.string("dry-run")` read fell back to its `withDefault`, because the runner exposes inputs as `INPUT_<MANGLED>` variables (uppercase, spaces→underscores, dashes survive) and a plain-named lookup finds nothing. Spencer ruled that `Action.run` must install an `ActionInput`-aware `ConfigProvider` as the default — "prevent trying to side-step the framework": a program that bypasses `ActionInput.*` should degrade to the right answer, not to the default.

The installed provider is `ActionInput.providerOver(ambient)`, built via `ActionInput.layerDefault` and composed into `ActionRuntime.layer` — so production `Action.run` and test programs composed over the runtime layer see identical resolution. It is **not** the record-backed `ActionInput.provider` the previous section probed; the semantics are deliberately narrower:

- A **flat, single string-segment** path — the only shape the runner could actually have set — first tries the `INPUT_` derivation of the name (through the same `inputVariable` that owns the mangling; the rule exists in exactly one place), then the name unchanged through the ambient provider. Nested and numeric paths pass through **untouched** — no path semantics the runner does not have, and none of the uppercasing cost the probe found.
- **The shadowing trade, pinned by test:** a workflow input named like an env var shadows it for bare reads, in any casing of the read (the derivation uppercases). An unsupplied input (`""`) does not shadow — the attempt resolves through the ambient provider, whose empty-is-absent rule drops it.
- **`ActionInput.*` accessors are unchanged:** they read `INPUT_<MANGLED>` names, whose re-mangled attempt (`INPUT_INPUT_…`) never matches, so they fall through to the ambient lookup they always used.
- **A caller-supplied `ConfigProvider` in the `layer` option wins**, by normal precedence: the extra layer's context merges last in `Action.run`'s composition (`Context.mergeAll` is last-wins), pinned by a test that sees the caller's value with the input variable set.

The ambient half is whatever provider is **explicitly installed** when the layer builds — how a test injects a deterministic environment beneath the runtime — and otherwise a **fresh** `ConfigProvider.fromEnv()` rather than the reference's default: v4 caches that default once per process (`Context.ts`'s `defaultValueCacheKey`), and a snapshot taken before the runner's variables were visible would resurrect exactly the missed-input class the ruling kills. An action's environment is fixed before its process starts, so production cannot tell the difference; a test mutating `process.env` around `Action.run` can, and the existing `Action.test.ts` env fixture only worked because the first `Config` read in the file happened to land after the mutation.

### The token bridge's one-hour contract — RULED

Installation tokens live about an hour, and a `main` phase rebuilt from a persisted token **cannot re-mint one**. The [checkpoint left this open](#githubtoken-the-bridge-and-its-member-usage); it is now ruled, in the conservative direction:

**Document the hour; never carry the credentials forward.** The credential that could re-mint is the app's private key, and persisting *that* through `GITHUB_STATE` — a plaintext file by GitHub's protocol — would trade a one-hour token for a permanent one. Instead:

- `GitHubToken.read` (and therefore `clientLayer`) fails typed with `GitHubTokenError { reason: "expired" }`, naming the expiry. `InstallationToken.isExpired` already existed and the predecessor read it nowhere, so a long `main` phase simply started answering `401` with no explanation — the single hardest failure in this lifecycle to diagnose from a workflow log.
- The skew is a minute by default and adjustable, because the check and the request it guards are not the same instant.
- A phase that can outlive the hour calls `provision` itself. That is a documented contract, not a workaround.
- `dispose` skips revoking an already-expired token. GitHub has stopped accepting it, so the request would fail and the only thing it could accomplish is turning a successful run into a failed one on the way out.

`provision` is an `acquireUseRelease` whose release arm **revokes on any failure** — scope verification, identity, persistence — because a workflow retrying a failing `pre` would otherwise leave an hour of unreferenced write tokens behind, each one a live credential nobody is tracking. The revoke is `Effect.ignore`d: the action is already failing for a reason the caller needs to see, and replacing it with "revocation failed" would hide it.

The member-usage table lives in the module's TSDoc and is **executable**: one test supplies exactly the documented members and succeeds, another supplies one fewer and dies. That is what makes it a contract rather than a comment.

### `Action.run`'s failure rendering — RULED against the call sites

The [checkpoint left the depth open](#settled-at-the-phase-3-checkpoint). Decided against what the consumers actually do: every one of them calls exactly `Action.run(program, { layer })`, and **nobody calls `formatCause`** (silk-runtime-action's `formatCauseDetail` is its own function over its own errors). So:

- **Kept:** one `::error::` line carrying `[Tag]: message` — what a human scanning a workflow log for the first red line needs — and the exit code, which is the piece `ActionOutputs.setFailed` deliberately leaves alone.
- **Kept, behind `::debug::`:** the full `Cause.pretty` render, span trace included. Genuinely useful, genuinely noisy, and the runner already owns the switch.
- **Dropped:** splicing a JS stack into the *visible* error. In a bundled action it points at one line of `dist/main.js`.
- **Dropped:** the three nested `try`/`catch` swallow blocks. One last-resort guard at the promise boundary does the same job — and `Action.run` never rejects, because an action entry point that rejected would produce an unhandled rejection *and* a failed step, of which only the first is legible.

`Action.run` also does **not** wrap the program in a log buffer. The predecessor did, and an unhandled defect inside the buffer swallowed the whole transcript: the run failed and printed nothing. `ActionLogger.withBuffer` flushes on every exit path including a defect, so buffering is opt-in and visible at the call site.

### `Artifact` shipped, minus one parameter

Ported conservatively per the ruling — the surface keeps the source's shape, with the stuttering `Artifact` prefix dropped from every member and `get` returning `Option`. One deliberate subtraction: **`FindBy` is not ported.** Every path through it in the source is a typed "not yet implemented" failure, so the parameter has never had behavior; porting one is porting a lie, and adding it later is additive whereas removing it later would not be.

Facts the protocol pinned that are easy to get wrong, each with a test: `CreateArtifact`'s `version` is **7** (a protocol version, unrelated to the `v4` in `actions/upload-artifact@v4` — which is the obvious wrong guess); `FinalizeArtifact` hashes the **stored zip**, streamed rather than read, because an artifact is the one payload here with no upper bound on size; entries are stored **relative to `rootDirectory`**, or a download rebuilds a tree named after the runner that produced it; and a conflict on create is a **failure**, unlike the cache, because a run may hold one artifact per name.

### Testing notes carried forward

- **The `settle` helper for retry tests.** A forked fiber plus a bounded `TestClock.adjust` loop, polling `fiber.pollUnsafe()`. Bounded rather than `while (true)`: a fiber blocked on something that is not a sleep would otherwise hang to the vitest timeout with no clue why.
- **A fake `fetch` must decode the request body through `Response`, not `String(init.body)`.** The body arrives as bytes; stringifying a `Uint8Array` yields `123,34,…`, which throws in `JSON.parse`, which inside a fake `fetch` surfaces as a *transport fault*, which the client then **retries**, which hangs the virtual clock. One misread fixture presented as ten unrelated timeouts in modules that had nothing wrong with them.
- **A test that sets `process.exitCode` must restore it.** `Action.run` sets it by design, and leaving it set fails the **vitest process** rather than the test — a green suite whose exit code says otherwise.
- Mutants killed in the closing session: the Twirp retry removed; the snake_case field fallback dropped; the finalized size taken from the body instead of the frame; the cache entry version computed over **sorted** paths; `matchedKey` ignored on restore; zip entries stored absolute; the `matchingFiles` directory filter loosened; Azure imported by `internal/twirp.ts`; mask-after-persist ordering; the revoke-on-failure release arm; the expiry check in `read`; `dispose` revoking an expired token; `identity` called without the installation token; `process.exitCode = 1`; and the workflow `Logger` dropped from the runtime.
- **A second semantics-preserving mutant, reported rather than papered over:** replacing `Artifact`'s `expiresAt` conditional spread with `expiresAt: undefined` changes nothing, because `JSON.stringify` drops undefined properties before the body reaches the wire. The conditional spread stays (house idiom, and honest about intent), and a sharper mutant — always computing an expiry — *is* killed.

### Where a successor would start

The package is complete; what is left is adoption. Two things a first consumer will exercise that nothing here could:

- **`Artifact` is provisional by ruling.** It was ported without a call site to shape it against, so the first consumer to adopt it is the one whose feedback reshapes it — including whether the cross-run lookup comes back.
- **The two integration paths are opt-in and unexecuted in CI**: a real Actions-cache round trip and a real S3-compatible round trip. The transport seam is how both are pointed at something local.

## Settled at the Phase 3 checkpoint

Ruled 2026-07-25; recorded so they are not reopened.

1. **`Artifact` ships in v1.** See [the Artifact section](#artifact--ships-in-v1-and-the-name-collision-that-nearly-sank-it) for the search evidence and the `GitHubArtifactMetadata` name collision behind it. The surface is ported conservatively and treated as provisional until a first real consumer reshapes it.
2. **`ToolInstaller`'s possible `@effected/runtimes` edge — NOT TAKEN.** The overlap turned out to be exactly as shallow as the checkpoint suspected: `runtimes` resolves *versions* and answers with a download URL; `ToolInstaller` takes a URL and installs *files*. Nothing in the installer wants a version resolver, and a consumer that wants both composes them in three lines. The edge stays free under [R3](../effect-standards.md#dependency-policy) if a real call site ever asks for it.
3. **`#144`'s `writeDirAtomic` — RULED 2026-07-25: the watch item FIRES.** Confirmed against the real extraction path rather than assumed, and proven by mutating the naive implementation back in. See [the as-built ruling](#144-is-ruled-stage-then-swap).
4. **`Action.run`'s failure rendering — RULED**, against the consumers' real call sites rather than in the abstract. See [the ruling](#actionruns-failure-rendering--ruled-against-the-call-sites); it arrived with tests, as required.
