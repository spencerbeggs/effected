---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-20
last-synced: 2026-07-20
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

`@effected/npm` is a **pure-tier** package (no `npm-effect` source repo behind it) that owns three things: the **dependency-resolution contracts** a package.json-document library defines but cannot implement — `CatalogResolver` and `WorkspaceResolver`, resolving pnpm `catalog:` / `workspace:` specifiers to concrete versions — the **cross-cutting npm vocabulary** that flows between the manifest, lockfile and workspace packages: `DependencySpecifier`, the dependency-section literals (`DependencyKind` / `DependencyField`) and `IntegrityHash` — and the **[`Manifest` domain model](#manifest-tolerant-manifest-level-resolution)**, manifest-level resolution built on the per-specifier contracts (2026-07-16, from the systems dogfood feedback).

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
- `index.ts` — the public surface and the composite `Default` layer (`Layer.mergeAll(CatalogResolver.noop, WorkspaceResolver.noop)`), which lives here because merging both no-op layers is the cycle-free home.

Every class factory is written **inline** with the synthesized `_base` heritage symbols suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern), per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), keeping `dist/prod/issues.json` zero-warning. The prod gate's expected suppressed count is **14** (`suppressed: 0` in the prod gate means the build did not run properly).

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

## Testing

`@effect/vitest`, `it.effect`; tests in `__test__/` per concept. The resolver surface is contracts, so those tests are light: the no-op layers return `Option.none()`, a stub-implementation layer proves the contract is implementable, and `DependencyResolutionError` preserves its structured `cause`. The vocabulary tests carry the weight — specifier classification across the protocol set, the `DependencySpecifier` round-trip property, the resolution projections (`catalogNameOf`, `resolveWorkspace`, `WorkspaceSpecifier#resolve`), `DependencyKind`/`DependencyField` mapping, and `IntegrityHash` across all three forms. `__test__/Manifest.test.ts` drives the tolerance boundary (dependency fields fail typed, everything else rides `rest` and round-trips), `needsResolution`, and `resolve()` over stub resolver layers including the `UnresolvedDependencyError` cases.
