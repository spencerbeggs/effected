---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-21
last-synced: 2026-07-21
completeness: 93
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - package-json.md
  - workspaces.md
  - lockfiles.md
  - semver.md
---

# @effected/npm design

## Overview

`@effected/npm` is a **pure-tier** package (no `npm-effect` source repo behind it) that owns three things: the **dependency-resolution contracts** a package.json-document library defines but cannot implement — `CatalogResolver` and `WorkspaceResolver`, resolving pnpm `catalog:` / `workspace:` specifiers to concrete versions — the **cross-cutting npm vocabulary** that flows between the manifest, lockfile and workspace packages: `DependencySpecifier`, the dependency-section literals (`DependencyKind` / `DependencyField`), `IntegrityHash` and the **[`ReleaseAgeGate`](#releaseagegate-the-release-age-gate-vocabulary)** publish-time gate — and the **[`Manifest` domain model](#manifest-tolerant-manifest-level-resolution)**, manifest-level resolution built on the per-specifier contracts (2026-07-16, from the systems dogfood feedback).

Resolution lives here rather than in package-json because it fundamentally requires workspace/catalog context that a manifest library cannot have; the full rationale is [resolution belongs to @effected/npm](package-json.md#resolution-belongs-to-effectednpm). The vocabulary lives here because these scalars are shared by three or more packages, and a single home stops each from prefix-sniffing its own reimplementation.

**Scope discipline.** API ships on evidence: a concept moves here only when a second consumer materializes. `PackageName` stays in [package-json](package-json.md) because it has one consumer. The [vocabulary registry](#vocabulary-registry) records where every npm concept lives so nobody rebuilds an idiom for lack of a map.

## Tier and dependencies

**Pure tier.** The package is abstract service contracts (Context tags + shapes), pure no-op default layers, and the vocabulary scalars — no IO, no untrusted-input parsing beyond specifier/integrity classification. The no-op default layers are `Layer.succeed` over pure functions returning `Option.none()`.

- `peerDependencies`: `effect` (`catalog:effect`) plus one pure-to-pure `workspace:~` edge, `@effected/semver`, mirrored in `devDependencies`. The `RangeSpecifier` case validates its range through `@effected/semver`'s `Range.FromString`, which is why the edge exists; it is declared as a peer, not a regular dependency. Closure holds: `effect` has no peers and `@effected/semver` declares only `effect`.
- `dependencies`: none.

The dependency arrows point mostly **at** this package: `@effected/package-json`, `@effected/lockfiles` and `@effected/workspaces` all depend on it via `workspace:~`.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); every concept file imports explicitly, no barrels. See `src/`:

- `CatalogResolver.ts` — the `catalog:` resolver contract + no-op layer.
- `WorkspaceResolver.ts` — the `workspace:` resolver contract + no-op layer; owns `DependencyResolutionError` (both resolvers raise it). `CatalogResolver.ts` type-imports the error, a one-way edge.
- `CatalogAssemblyError.ts` — the typed catalog-assembly failure, relocated here from `@effected/workspaces` (see [the error seam](#resolver-contracts)). A leaf module rather than a resident of `CatalogResolver.ts` for the same reason `DependencyResolutionError` lives in `WorkspaceResolver.ts`: both resolver modules must reference it without an import cycle.
- `Manifest.ts` — the `Manifest` domain model, `ManifestDecodeError` and `UnresolvedDependencyError`.
- `DependencySpecifier.ts` — the branded specifier, its classification statics and the `FromString` codec to the classified union.
- `DependencySection.ts` — the `DependencyKind` / `DependencyField` literals and their mapping.
- `IntegrityHash.ts` — the SRI/corepack/yarn integrity brand.
- `ReleaseAgeGate.ts` — the `ReleaseAgeGate` class and its permissive `PartialReleaseAgeGate` input shape; the pure release-age gate vocabulary (see [ReleaseAgeGate](#releaseagegate-the-release-age-gate-vocabulary)).
- `index.ts` — the public surface and the composite `Default` layer (`Layer.mergeAll(CatalogResolver.noop, WorkspaceResolver.noop)`), which lives here because merging both no-op layers is the cycle-free home.

Every class factory is written **inline** with the synthesized `_base` heritage symbols suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern), per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), keeping `dist/prod/issues.json` zero-warning. The prod gate's expected suppressed count is **15** (`ReleaseAgeGate`'s `_base` joined the count when the gate landed; `suppressed: 0` in the prod gate means the build did not run properly).

## Resolver contracts

Both contracts use `Context.Service<Self, Shape>()("@effected/npm/…")` — type params first, string id last — with the `Shape` inlined structurally. No-op layers are `static readonly noop = Layer.succeed(Class, { ...impl })`, bound to a const so they memoize by reference.

- **`CatalogResolver`** — `rangeOf(packageName, catalog: Option<string>) → Effect<Option<string>, CatalogAssemblyError | DependencyResolutionError>`. `Option.none()` catalog means the default catalog; the result is the configured range, or `Option.none()` if unresolvable.
- **`WorkspaceResolver`** — `versionOf(packageName) → Effect<Option<string>, DependencyResolutionError>`. Returns the concrete version without the range modifier, or `Option.none()`.
- **`DependencyResolutionError`** — a `Schema.TaggedErrorClass` with `specifier: string`, a `cause: Schema.Defect()` (never a stringified message) and a computed `get message()`. Reserved for **mechanism failure**; an unmatched specifier is the `Option.none()` convention, not an error.
- **`CatalogAssemblyError`** — the typed failure of catalog *assembly* (`source: manifest | catalog | hooks`, `path`, structured `cause`), **relocated here from `@effected/workspaces`** (2026-07-16, dogfood item 3). The reasoning: the contract package owns the contract's error vocabulary. When the error lived in the implementing package, `rangeOf` could only name `DependencyResolutionError`, so implementations folded assembly failures into its defect `cause` and every consumer `_tag`-sniffed `unknown` to tell an assembly failure from a resolution failure. With the error beside the contract, `rangeOf`'s channel is the typed union and the sniffing adapter dies in every consumer. `@effected/workspaces` imports it back from here — deliberately **no re-export from workspaces**, so there is exactly one home.
- **`Default`** — the composite layer a consumer provides when it just needs `Package.resolve` to type-check while resolving nothing.

`@effected/workspaces` implements both contracts directly as layers over its own services, and the unmatched-name-is-`None` convention holds without amendment ([workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts)).

## Manifest: tolerant manifest-level resolution

`Manifest` (`src/Manifest.ts`) is the manifest-level resolution the per-specifier contracts could not offer alone (2026-07-16, dogfood item 2): a `Schema.Class` domain model of a **tolerant** manifest, replacing the originally planned `ManifestResolver` grouped const with a real domain type (Spencer's mid-flight directive).

**The wire codec is deliberately tolerant, and the tolerance boundary is precise.** The four dependency fields are typed `string→string` records and **validate** — a malformed dependency field, or a non-record input, fails typed as `ManifestDecodeError` (structured `SchemaError` on `cause`, never stringified). **Everything else round-trips unvalidated**: the codec partitions the four dependency field names into typed members on decode and lands every other top-level key verbatim in a `rest` catch-all, flattened back to the top level on encode (no literal `rest` key ever appears on the wire) — mirroring `@effected/package-json`'s `makeWire` transform at a smaller scale, without taking the dependency. The rationale: mid-build manifests are arbitrary user records, and forcing them through the strict `Package` decode would fail resolution on fields this module never reads. Consumers wanting the strict model use `Package`.

The surface, all on the class:

- **`Manifest.decode(input)`** (static) — decode any unknown value through the tolerant wire codec (`Manifest.schema`), normalizing `SchemaError` to `ManifestDecodeError` at the boundary.
- **`needsResolution`** (getter) — the pure fast-path predicate: does any dependency field carry a `catalog:` or `workspace:` specifier? Callers use it to skip catalog assembly entirely.
- **`resolve()`** (instance) — project every `catalog:` specifier through `CatalogResolver` and every `workspace:` specifier through `WorkspaceResolver` + `DependencySpecifier.resolveWorkspace`, returning a **new** `Manifest` (never mutating, `rest` carried over). Requires `CatalogResolver | WorkspaceResolver` in `R`; the error channel is `CatalogAssemblyError | DependencyResolutionError | UnresolvedDependencyError`.
- **`toRecord()`** (instance) — encode back to the wire shape, `rest` flattened.

**`UnresolvedDependencyError`** is the manifest-level reading of the contracts' `Option.none()` convention: the resolution *mechanism* worked, the answer was empty — no catalog entry, no workspace package by that name — and a manifest with an unanswerable specifier cannot be projected to concrete ranges. It is distinct from the mechanism errors by design; the per-specifier contracts keep their `None`-is-success convention untouched.

`@effected/workspaces` wraps `resolve()` in the one-shot `Workspaces.resolveManifest` over its real resolver implementations ([workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts)).

## DependencySpecifier

One specifier grammar spans the kit — lockfiles, workspaces and package-json all classify a specifier the same way. The branded string is the ground truth: its classification statics distinguish the full protocol set (`range | tag | git | url | npm | file | link | portal | catalog | workspace | unknown`). package-json re-exports the specifier vocabulary from here for surface compatibility, so the home is source-transparent to its consumers.

A `FromString` codec (`Schema.Codec<ClassifiedSpecifier, string>`) decodes the brand to a five-case tagged union (`Schema.TaggedClass` each), grouping the protocols the *resolvers* distinguish while the finer classification survives as the statics:

- **`CatalogSpecifier`** — a `catalog:` reference, default vs named.
- **`WorkspaceSpecifier`** — a `workspace:` reference, carrying its range or alias form.
- **`RangeSpecifier`** — a plain semver range, validated through `@effected/semver`'s `Range.FromString`.
- **`DistTagSpecifier`** — a bare tag (`latest`, `next`).
- **`RawSpecifier`** — the honest fallback for `file:` / `link:` / git / URL forms this package does not further interpret.

**Exact-string round-trip is structural, not reconstructed.** Every union case stores the original `raw` string and `encode` returns `raw`, so decode∘encode is byte-for-byte identity by construction rather than by re-serializing classified fields. That is what lets brownfield consumers (silk-update-action's lockfile diffing, systems' dependency-regeneration) reimplement on the new model without ever losing the raw specifier; an `it.effect.prop` round-trip suite pins it.

**Resolution projections live with the specifier** (2026-07-16, dogfood item 1 — vocabulary the kit typed but consumers hand-rolled). `catalogNameOf(spec): Option<string>` extracts a `catalog:` specifier's catalog name, `None` selecting the default catalog; `resolveWorkspace(spec, version): string` is the pnpm publish-time projection (`workspace:*` or bare → the version, `workspace:^`/`workspace:~` → prefixed version, anything else — pinned range or alias form — passes through). `WorkspaceSpecifier#resolve(version)` applies the same projection to an already-classified instance. Each projection has **one** internal implementation shared between the static, the classifier and the instance method, so they can never disagree.

## Dependency-section vocabulary

One concept, owned here as two `Schema.Literals`: `DependencyKind` (the short kinds `prod`/`dev`/`peer`/`optional`) and `DependencyField` (the manifest field names `dependencies` … `optionalDependencies`), with `KIND_TO_FIELD` the single source of truth and its inverse derived from it, exposed through `fieldOf` / `kindOf`. package-json's `Dependency.kind` types against `DependencyKind`; lockfiles consumes `DependencyField`.

## IntegrityHash

An SRI brand covering **three** textual forms, because lockfile integrity is not all-SRI: npm/pnpm record `sha512-<base64>` SRI, corepack records the `name@version+sha512.hex` pin form, and yarn Berry records `<cachekey>/<hex>` cache checksums. Dropping the yarn form would silently discard integrity the [lockfiles](lockfiles.md) model treats as load-bearing, so the brand covers all three. `algorithmOf` returns `Option.none()` for the yarn form (which names no algorithm); the SRI and corepack forms report theirs.

## ReleaseAgeGate: the release-age gate vocabulary

pnpm's publish-time **release-age gate** is shared npm vocabulary, so it is resident here (2026-07-21, dogfood request from systems relaying silk-update-action, which fails `ERR_PNPM_NO_MATURE_MATCHING_VERSION` without it). pnpm reads two config keys — `minimumReleaseAge` (minutes a published version must age before it is eligible) and `minimumReleaseAgeExclude` (name patterns exempt from the gate) — and refuses to install a version younger than the cutoff. A resolver that picks the highest in-range version with no publish-time awareness picks a version pnpm then rejects; mirroring the gate at resolution time (drop too-young candidates before picking) fixes it.

This is a **schema-first port of the gate vocabulary only.** `ReleaseAgeGate` is a `Schema.Class` — `ageMinutes` (non-negative, finite) and `exclude` (`readonly string[]`) — with:

- **`combine(...contributions)`** (static, variadic, **total**) — assembles the effective gate from partial contributions across sources (inline `pnpm-workspace.yaml`, replayed hooks, `pnpm config get`): **strictest age wins** (clamped `Math.max`, non-finite contributions ignored), exclude sets **union** (deduplicated, lexicographically sorted — a canonical, contribution-order-independent wire form). Zero contributions yield the inert zero gate (`ageMinutes: 0`, `exclude: []`). It never throws — which is why the partial input shape does not clamp.
- **`matchesExclude(name, patterns)`** (static) plus instance **`isExcluded(name)`** — flat-string `*` matching with **`@pnpm/matcher` parity: `*` crosses `/`**, so a bare `*` matches a scoped name and `@scope/*` matches a whole scope. This is **deliberately NOT `@effected/glob`'s minimatch dialect** (where `*` refuses to cross `/`); pnpm treats the package name as a flat string, and routing through `@effected/glob` would silently change which packages a gate exempts. The divergence is documented in the module's TSDoc — do not "fix" it.
- **`filterVersions(versions, times, name, now)`** (instance, **pure, caller-supplied clock**) — drops versions younger than the cutoff (`now - ageMinutes * 60000`) and versions with a missing or unparseable timestamp (pnpm's strict posture: an unestablishable age is too young); a version exactly at the cutoff is kept. A no-op when the gate is inert (`ageMinutes <= 0`) or the name is excluded. No error channel; it reads no wall clock.

**`PartialReleaseAgeGate`** is the permissive input: a `Schema.Struct` with `optionalKey` `ageMinutes` / `exclude` and **no non-negative check** — raw values arrive from arbitrary config sources and `combine` is the single clamping authority. A source sets the age, the exclude list, both, or neither.

**Consumer-side config readers are deliberately NOT ported.** `readConfigReleaseAge` / `parsePnpmGate` from the rolldown-pnpm-config reference stay out — reading the gate from `pnpm-workspace.yaml` keys or replayed `updateConfig` hooks is config IO, a boundary/integrated concern. `@effected/workspaces` owns that assembly (`WorkspaceCatalogs.releaseAgeGate`, its `ConfigDependencyHooks` release-age surfacing — [workspaces.md](workspaces.md#configdependencyhooks--the-opt-in-replay-seam)); this pure module is the vocabulary those readers combine into.

## Vocabulary registry

Four packages (npm, package-json, lockfiles, workspaces) operate around overlapping npm concepts. This registry maps where each concept lives, surveyed against npm's [`package.json`](https://docs.npmjs.com/cli/v12/configuring-npm/package-json) and [`package-lock.json`](https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json) documentation. **API ships on evidence, the registry ships the map**: an unmodeled concept stays unmodeled until a consumer materializes, but nobody rebuilds an idiom for not knowing its home.

Standing assignments: versions and ranges → `@effected/semver`; manifest shapes → `@effected/package-json`; lockfile shapes → `@effected/lockfiles`; workspace/monorepo semantics → `@effected/workspaces`; cross-cutting scalars that flow between those concerns → here.

### package.json

| Field | Status | Home / notes |
| --- | --- | --- |
| `name` | modeled | package-json `PackageName` (brand + statics) |
| `version` | modeled | package-json via `@effected/semver` `SemVer.FromString` |
| `description`, `private`, `type`, `main` | modeled | package-json `Package` first-class fields |
| `license` | modeled | package-json `SpdxLicense` (real SPDX validation) |
| `author` / `contributors` | modeled | package-json `Person.FromValue` (string and object forms) |
| `repository` | modeled | package-json `RepositoryField` |
| `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` | modeled | package-json `DependencyMapField`; specifiers classify via `DependencySpecifier` (here); section vocabulary is here |
| `peerDependenciesMeta` | modeled | package-json `PeerDependenciesMetaField` |
| `scripts` | modeled | package-json (string map) |
| `bin` | modeled | package-json `BinField` |
| `engines` | modeled | package-json (string map) |
| `exports` | modeled | package-json `ExportsField` |
| `publishConfig` | modeled **twice, deliberately** | package-json `PublishConfigField` and workspaces `PublishConfig` — an accepted duplication: `WorkspacePackage` is deliberately tolerant and takes no package-json edge |
| `packageManager` | modeled | package-json `PackageManager` (`name@version+integrity` codec); integrity half re-points to `IntegrityHash` |
| `devEngines` | modeled | package-json `DevEnginesSchema`; workspaces separately *reads* the field as a detection hint without modeling it |
| `workspaces` | read, not modeled | workspaces reads globs and bun-style `catalog`/`catalogs`; package-json preserves the field via `rest`. Trigger for modeling: a consumer needing to *write* the field |
| `keywords`, `homepage`, `bugs`, `funding` | preserved, not modeled | package-json `rest`. Trigger: a consumer that reads or validates them |
| `files`, `browser`, `man`, `directories` | preserved, not modeled | package-json `rest` (a consumer wanting glob *matching* on `files` would route through `@effected/glob`) |
| `config`, `gypfile` | preserved, not modeled | package-json `rest`. No plausible kit consumer |
| `bundleDependencies` | preserved, not modeled | package-json `rest`. Trigger: pack/publish tooling |
| `overrides`, `packageExtensions` | preserved, not modeled | package-json `rest`. Trigger: dependency-rewrite tooling |
| `os`, `cpu`, `libc` | preserved, not modeled | package-json `rest`. Trigger: install-planning tooling |

### package-lock.json

The lockfiles npm parser normalizes `package-lock.json` into the one `Lockfile` model rather than modeling it field-for-field; this records what survives normalization and what is discarded.

| Concept | Status | Home / notes |
| --- | --- | --- |
| `lockfileVersion` | kept | `Lockfile.lockfileVersion` (string-normalized) |
| `packages` map (v2/v3) | parsed | the entry source for `ResolvedPackage`; root `""` and workspace-path entries → workspace packages, `node_modules/*` → resolved packages |
| legacy v1 `dependencies` section | not parsed | the parser requires the `packages` map; a v1-only lockfile fails typed |
| entry `version` | kept | `ResolvedPackage.version` |
| entry `integrity` | kept | `ResolvedPackage.integrity` — re-points to `IntegrityHash` |
| entry `dependencies` / `optionalDependencies` | kept | workspace-entry sections feed `WorkspaceDependency` edges and `Lockfile.importers` |
| root/workspace declared deps | kept | `Lockfile.importers` (`LockfileImporter` / `ImporterDependency`) |
| entry `resolved` (registry/git/link URL) | discarded | Trigger: provenance tooling (audit, mirror verification) |
| entry `link`, `dev`, `optional`, `devOptional`, `inBundle` | discarded | tree-membership flags. Trigger: a consumer reasoning about install trees |
| entry `hasInstallScript` | discarded | Trigger: a security/audit consumer |
| entry `bin`, `license`, `engines`, `os`, `cpu`, `funding` | discarded | manifest mirrors; package-json is the source of truth |
| hidden lockfile (`node_modules/.package-lock.json`) | out of scope | a performance artifact of npm; `Lockfile.parse` takes content and does not care where it came from |

## Phase 5 extension

Designed and **built** 2026-07-25 for [Phase 5 of the GitHub/Actions split](../../../plans/2026-07-25-github-split-master.md#phases). Adds three service-side modules — `NpmRegistry` (registry reads over core `HttpClient`), `PackagePublish` (the npm CLI through [`@effected/commands`](commands.md)) and the `RegistryKind` classifier — replacing `@savvy-web/github-action-effects`' services of the same names. As-built deltas are recorded [at the end of this section](#as-built-2026-07-25).

### The tier ruling: pure → boundary, deliberately, with a guardrail

**This package becomes boundary tier.** Not by [R2](../effect-standards.md#dependency-policy) — the new `@effected/commands` edge is boundary and carries zero runtime dependencies, and boundary does not propagate — but by **[R4](../effect-standards.md#dependency-policy)**: the package now performs IO itself, through core-declared contracts (`HttpClient`, `ChildProcessSpawner`, `FileSystem`, `Path`, `Crypto`) required in `R`. That is the walker/xdg/`@effected/git` shape, and it is what "boundary" means.

**Nothing downstream moves.** `@effected/lockfiles` stays **pure** and `@effected/package-json` stays **boundary**: R3 is explicit that a boundary dependency does not propagate, because the IO is discharged by the application's platform layer at the edge. A consumer that only wants `IntegrityHash` pays no install beyond `@effected/commands`, which itself has zero runtime dependencies.

**The tree-shaking obligation is real and is met by the existing rule.** `@effected/lockfiles` imports `IntegrityHash` from this package's entrypoint; that import must not link `Run` or `HttpClient`. It does not, provided the two new services stay **free-standing named exports** — the [config-file codec precedent](../effect-standards.md#no-barrel-re-exports): a bundler sees through a re-export barrel, but a namespace object is a single live binding that retains every member's graph. So: **never group `NpmRegistry` and `PackagePublish` into an `Npm` namespace object**, and never collect the vocabulary and the services behind one const. This is the same hazard the four codecs measured, one package over.

**The guardrail, and it is the important half.** This extension is admissible *only while it stays core-contracts-plus-commands*. The moment either service takes a non-core runtime dependency — an npm client library, a tarball reader, a registry SDK — the package becomes **integrated**, and then R2 *does* propagate: `lockfiles` (pure) and `package-json` (boundary) both move with it, and every consumer of those pays. If that day comes the answer is not "accept integrated npm" but **split the services into their own package** (`@effected/npm-registry`), leaving the contracts and vocabulary pure here.

That split is the recorded alternative for this decision. It was considered and rejected *now* because the new services' densest dependency is this package's own vocabulary — `IntegrityHash`, `ReleaseAgeGate`, `DependencySpecifier` — so splitting today buys a package boundary between two halves that talk constantly, to protect a tier distinction that R3 already protects. The trigger to revisit is the guardrail above, not taste.

### Consumer evidence, and the shape it dictates

The mandate's per-`(package, version)` keying comes from a shipped test double breaking twice ([spec §7](../../../plans/2026-07-25-github-split-master.md)). Reading both sites, the diagnosis is **one dimension wider than the mandate states**:

- `silk-update-action/src/services/catalog-config-deps.test.ts:85-92` — the double carries one tarball URL *per package*, so it cannot serve two **versions** of one package. The three-way merge that needs base-vs-next tarballs is untestable; the test hand-rolls its own stub.
- `silk-release-action/src/release/publish.test.ts:1321-1330` — `getPublishedIntegrity` keys by package name alone, so it cannot return different answers for two **registries**. The test's own comment records the workaround, then abandons it for a custom layer.

So the model is keyed by **`(registry, package, version)`**, and `registry` is a **per-call argument, never baked into the layer** — the publish flow probes two registries for one package inside a single program (`publish.ts:505-540`), which is precisely what a layer-baked registry cannot express. The old service half-knew this (`getPublishedIntegrity` requires a `registry` option while its siblings default it); the extension makes it uniform.

### `NpmRegistry` — reads over core `HttpClient`

Replaces every shelled `npm view`. Verified against `.repos/effect`: `HttpClient.get(url)` requires `HttpClient` in `R`, `HttpClientResponse.schemaJson` decodes a body through a schema, and `HttpClientError`'s `StatusCodeError` carries the response — so a 404 is detected **structurally**, not by matching `npm error code E404` on stderr as the v3 layer does.

```ts
/** A registry to read from. Per call, never layer-baked. */
export interface RegistryTarget {
  readonly registry: string;                              // defaults to the public registry
  readonly token?: Redacted.Redacted<string> | undefined; // read auth, when required
}

export interface NpmRegistryShape {
  /** One published version's metadata, or None when that version is not on that registry. */
  readonly version: (name: string, version: string, target?: RegistryTarget) =>
    Effect.Effect<Option.Option<PublishedVersion>, RegistryReadError>;
  /** Every published version, newest last. */
  readonly versions: (name: string, target?: RegistryTarget) =>
    Effect.Effect<ReadonlyArray<string>, RegistryReadError>;
  /** The dist-tag map (`latest`, `next`, …). */
  readonly distTags: (name: string, target?: RegistryTarget) =>
    Effect.Effect<Record<string, string>, RegistryReadError>;
  /** Publish timestamps per version — the endpoint that replaces `npm view <pkg> time --json`. */
  readonly publishTimes: (name: string, target?: RegistryTarget) =>
    Effect.Effect<ReadonlyArray<PublishTime>, RegistryReadError>;
}

export class PublishedVersion extends Schema.Class<PublishedVersion>("PublishedVersion")({
  name: Schema.String,
  version: Schema.String,
  integrity: Schema.optionalKey(IntegrityHash),   // this package's own brand
  tarball: Schema.optionalKey(Schema.String),
  publishedAt: Schema.optionalKey(Schema.DateTimeUtc),
}) {}
```

Four things this fixes, each traceable to a call site:

- **`publishTimes` is the publish-time endpoint the mandate asks for.** `silk-update-action/src/services/release-age.ts:191-218` shells `npm view <pkg> time --json`, `JSON.parse`s it, and filters out the `created`/`modified` keys by hand — then swallows every failure into `{}` with a log line. As a registry read it is one typed call, and the result feeds `ReleaseAgeGate.filterVersions` (already resident here) without an adapter. **The `created`/`modified` split becomes the schema's job**, which is why `PublishTime` is a class rather than a bare record: the registry's `time` object mixes per-version timestamps with two non-version keys, and every consumer that reads it raw re-derives that exclusion.
- **404 is `Option.none()`, not an error** — extending this package's existing `None`-is-success convention from the resolver contracts to registry reads, so the whole package answers absence one way. The v3 `isE404` stderr regex disappears with the shell-out.
- **`integrity` is `IntegrityHash`**, not `string`. The brand already lives here and already covers the SRI form the registry stores; typing it is free and kills a compare-two-strings-and-hope at the publish call site.
- **Errors sized to the reads that exist.** v3's `NpmRegistryError` carries `operation: "view" | "search" | "versions"` — `"search"` is never produced — and a `reason: string` that consumers matched on. The replacement is one `RegistryReadError` with `kind: Schema.Literals(["transport", "status", "decode"])`, the package name, the registry, an optional `status`, and `cause: Schema.Defect()`. No prose routing surface.

### `PackagePublish` — the npm CLI through `@effected/commands`

```ts
export interface PackagePublishShape {
  /** Write a registry auth line to an npmrc. Returns nothing; masking is the CALLER's job. */
  readonly setupAuth: (options: {
    readonly registry: string;
    readonly token: Redacted.Redacted<string>;
    readonly npmrcPath: string;
  }) => Effect.Effect<void, PublishError>;
  /** `npm pack --json` → the tarball and its digests. */
  readonly pack: (packageDir: string, options?: PackOptions) => Effect.Effect<PackedTarball, PublishError>;
  /** `npm publish <tarball>` — uploads bytes packed earlier, never re-packs. */
  readonly publishTarball: (tarball: string, options: PublishOptions) => Effect.Effect<PublishOutcome, PublishError>;
  /** `npm publish --dry-run` — packability and sizing only; a failed dry run is a RESULT. */
  readonly dryRun: (packageDir: string, options?: PackOptions) => Effect.Effect<DryRunOutcome, PublishError>;
}
```

**The executor dispatch collapses into `LocalExec`.** v3 repeats a `packageManager?: "npm" | "pnpm" | "yarn" | "bun"` option on five method signatures, whose only job is choosing between `npm`, `pnpm dlx npm@11`, `yarn npm` and `bun x npm` — because OIDC trusted publishing needs a *fresh* npm, not the runner's bundled one. `@effected/commands` already models exactly this: `ExecContext.applyDlx` is "fetch-and-run a package binary", so `ChildProcess.make("npm@11", args).pipe(...)` through `applyDlx` **is** `pnpm dlx npm@11 args`. The extension therefore carries one `NpmExecutor` value (`ambient` | `dlx(spec)`) instead of five repeated options, and the package-manager knowledge stays in the one package that owns it.

**Every invocation goes through `Run`, and the fluent shape is settled:**

```ts
const packed = yield* Run.json(
  ChildProcess.make("npm", ["pack", "--json"]).pipe(ChildProcess.setCwd(packageDir)),
  PackJson,
  { timeout: "5 minutes" },
);
```

`Run.json` parses **and** schema-decodes, so `notJson` and `schema` failures stay distinguishable — v3 folded both into a `reason` string. A non-zero `npm` exit is already a typed `CommandFailedError`; `dryRun` deliberately catches it and reports `ok: false`, because a failed dry run is a valid answer rather than an error (v3 got this right and it is preserved).

**Token masking is hoisted, and the `.npmrc` write is kept.** v3's `setupAuth` calls `ActionOutputs.setSecret` — an Actions edge inside a publish library, the [spec §5 smell](../../../plans/2026-07-25-github-split-master.md). Here `setupAuth` takes a `Redacted` and masks nothing; the caller (`@effected/github-actions`) masks. What is **not** dropped is writing `_authToken` into an npmrc rather than passing it on argv: `Redaction` protects this kit's error messages, not the operating system's process table, so keeping the token off argv stays the security-correct choice. The npmrc path is a **caller-supplied argument** — resolving `~/.npmrc` needs `os.homedir()`, and a boundary package may not `node:` import.

**`publishIdempotent` is not ported.** v3 deprecates it in its own TSDoc: the fused probe-then-publish hardcoded the wrong registry and could not recover from a partial multi-registry publish. The composition it replaced — `pack` once, then per target `NpmRegistry.version(...)` → compare `integrity` → `publishTarball` — is what `silk-release-action` already does by hand and reads better than the fused call. Consumer composition, not a method.

### Module map

Three new modules; the existing five are untouched.

| Module | Owns |
| --- | --- |
| `src/NpmRegistry.ts` | the service + layer, `RegistryTarget`, `PublishedVersion`, `PublishTime`, `RegistryReadError` |
| `src/PackagePublish.ts` | the service + layer, `PackedTarball`, `PublishOutcome`, `DryRunOutcome`, `PublishError` |
| `src/NpmExecutor.ts` | the ambient-vs-dlx executor value over `LocalExec` |

Both services follow the kit's non-negotiables: all-effectful shapes, `static readonly layer` using `this`, `makeTest`/`layerTest` with unstubbed members dying loudly, `Effect.fn` named spans on public boundaries (attributes: package name, registry host, version — never a token, never argv).

### Testing

The double is the point of this phase. `NpmRegistry.makeTest` seeds a map keyed by **`(registry, name, version)`**, so the two call sites that hand-rolled stubs can delete them:

```ts
const registry = NpmRegistry.layerTest({
  versions: { "https://registry.npmjs.org/": { "pkg": ["1.0.0", "1.1.0"] } },
  integrity: { "https://npm.pkg.github.com/": { "pkg@1.1.0": "sha512-…" } },
});
```

Reads run against a stubbed `HttpClient` (core-declared, no platform package) for the layer's own tests; `PackagePublish` runs against `@effected/commands`' scripted-spawner fixture, which already records argv — so "the token never reached argv" is an assertion, not a hope.

### Open questions

All three were ruled on at the Phase 5 checkpoint and are recorded here with their answers.

1. **npmrc path resolution** — **caller-supplied**, as proposed. Resolving `~` needs `node:os`, which a boundary package may not import; the `@effected/xdg` alternative stays available if a consumer asks twice.
2. **`NpmRegistry` read auth** — **kept, optional**. No surveyed call site reads a private registry, but the field costs nothing and a private-registry read is a plausible next ask.
3. **Packument caching** — **deferred** until a consumer's call pattern shows the waste. `versions`, `distTags` and `publishTimes` each fetch the same document; core `Cache` keyed `(registry, name)` is the fix when it is wanted, with the failure/absence TTL rules the commands work established.

### As built (2026-07-25)

Three source modules plus a shared error module, 65 new tests (165 for the package), `tsc --noEmit` clean, and a prod `issues.json` of **0 warnings / 0 errors / 23 suppressed** (was 15; the eight new class factories account for the difference). Three genuine `ae-missing-release-tag` warnings on exported interfaces were **fixed, not suppressed**.

**The tier flip is real and is now enforced by a test.** The package is **boundary** by [R4](../effect-standards.md#dependency-policy) — it performs IO itself through `HttpClient`, `ChildProcessSpawner`, `FileSystem` and `Crypto` in `R`. `@effected/lockfiles` stays **pure** and `@effected/package-json` stays **boundary** under R3. `__test__/reachability.test.ts` asserts both halves of the guardrail from the source graph: the eight vocabulary modules import neither service nor `@effected/commands`, and `index.ts` declares no `export * as` namespace object. It is proven discriminating (adding an `@effected/commands` import to `IntegrityHash.ts` fails it), and it exists because the guardrail was otherwise only prose in a design doc.

**Deltas from the draft, each with its reason:**

- **`RegistryKind` + `classifyRegistry` are new** (scope addition from the consumer survey). The v3 helpers `isNpmRegistry` / `isGitHubPackagesRegistry` / `isJsrRegistry` / `isCustomRegistry` are replaced by **one** classification rather than four predicates, so a consumer `switch`es exhaustively instead of composing booleans that can disagree — v3 had one call site asking two in sequence and another negating a third to mean "everything else". The domain match is exact-or-subdomain with a leading dot, because a bare `endsWith` classifies `evil-npmjs.org` as the public registry and that classification decides whether a token is sent.
- **`getRegistryDisplayName` is deliberately dropped.** It is display-only, and the evidence says a library-canonical string serves nobody: `report.ts` renders "GitHub Packages" while `registry-label.ts` renders "github" from the same input. Consumers switch on `RegistryKind` and choose their own words.
- **`--provenance` is filtered to npm registries.** Carried from v3 (`isNpmRegistry` gated the flag) and now enforced by the classifier: npm rejects the flag against GitHub Packages, and a release publishing to three registries should not lose two of them to one flag.
- **`PublishError` lives in its own module** — both `NpmExecutor` and `PackagePublish` raise it and the former is imported by the latter, so a shared leaf is the only cycle-free home. Same reasoning as `DependencyResolutionError` and `CatalogAssemblyError`.
- **A sixth error kind, `"digest"`.** When `npm pack` **succeeds** but the tarball cannot be read back for hashing, reporting `kind: "pack"` sends a reader hunting npm's output for an error npm never produced.
- **`NpmExecutor.dlx` fails typed with no launcher**, rather than degrading to the ambient npm — degrading reintroduces the exact OIDC failure the pinned spec exists to avoid, invisibly.
- **`PublishedVersion` carries no `publishedAt`.** The draft had one; the version endpoint does not serve a timestamp (the packument's `time` object does), so the field would have been permanently absent. `publishTimes` is the answer.
- **`layerSeeded` ships alongside `layerTest`.** The kit rule is `layerTest(Partial<Shape>)` with unstubbed members dying loudly; the draft sketched a *seeded* double. Those are different tools, so both exist: `layerTest` for stubs, `layerSeeded(RegistrySeed)` for a working fake registry keyed `(registry, name, version)` — the shape the two broken v3 call sites were hand-rolling.
- **Service `R` is discharged at construction.** `Run.collect` requires `ChildProcessSpawner` and `NpmExecutor.command` requires `LocalExec`; both are resolved in `make` and provided with `Effect.provideService`, so every method's `R` is `never` (the `@effected/git` shape). The next kit service built over `commands` will hit this identically.

**Mutation-tested claims** (each mutant run, observed red, reverted): the scoped-package URL encoding; 404-as-absence; the seeded double's registry axis; the npmrc auth-key trailing slash; a failed dry run staying a result; `dlx` degrading silently; the lookalike-domain guard; and the reachability test itself.

## Testing

`@effect/vitest`, `it.effect`; tests in `__test__/` per concept. The resolver surface is contracts, so those tests are light: the no-op layers return `Option.none()`, a stub-implementation layer proves the contract is implementable, and `DependencyResolutionError` preserves its structured `cause`. The vocabulary tests carry the weight — specifier classification across the protocol set, the `DependencySpecifier` round-trip property, the resolution projections (`catalogNameOf`, `resolveWorkspace`, `WorkspaceSpecifier#resolve`), `DependencyKind`/`DependencyField` mapping, `IntegrityHash` across all three forms, and `ReleaseAgeGate` (`combine`'s strictest-wins/union/totality, `@pnpm/matcher`-parity `matchesExclude`, and `filterVersions`' cutoff/exactly-at-cutoff/missing-timestamp/inert/excluded cases). `__test__/Manifest.test.ts` drives the tolerance boundary (dependency fields fail typed, everything else rides `rest` and round-trips), `needsResolution`, and `resolve()` over stub resolver layers including the `UnresolvedDependencyError` cases.
