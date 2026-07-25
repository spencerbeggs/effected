# @effected/npm

Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers.

**For full design rationale and deferred decisions:**
→ `@../../.claude/design/effected/packages/npm.md`

Load when changing contract shapes, adding a resident concept, or reconciling against a real resolver.

## What this is

An **internal package with no source repo** — not migrated from a `*-effect` repo. It was extracted from the `@effected/package-json` port to hold the dependency-resolution contracts that package-json *defines but cannot implement*: resolving a specifier needs workspace and catalog context a package.json-document library has no access to. Contract here, implementation elsewhere.

**Boundary tier since the Phase 5 extension (2026-07-25) — this package was pure, and the change is deliberate.** `NpmRegistry` and `PackagePublish` perform IO themselves through core contracts in `R` (`HttpClient`, `ChildProcessSpawner`, `FileSystem`, `Crypto`), which is [R4](../../.claude/design/effected/effect-standards.md#dependency-policy)'s definition of boundary. It is **not** R2: the `@effected/commands` edge is boundary with zero runtime deps and does not propagate.

Peers on `effect` plus one pure-to-pure `@effected/semver` edge — `workspace:~` in `peerDependencies` (so a published patch floats), mirrored by the plain `workspace:*` in `devDependencies`, never `dependencies` — used only to detect ranges in `DependencySpecifier`. `@effected/commands` is a `workspace:~` **dependency**. Still zero *external* runtime deps.

### The guardrail, and it is enforced

`@effected/lockfiles` is **pure** and depends on this package for vocabulary only. It stays pure under R3 — a boundary dependency does not propagate — but only while two things hold:

1. **The pure vocabulary modules must not reach IO.** `IntegrityHash`, `DependencySpecifier`, `DependencySection`, `ReleaseAgeGate`, the resolver contracts and `Manifest` import neither service nor `@effected/commands`.
2. **`index.ts` must export individually.** A namespace object (`export * as`) is one live binding: a bundler cannot see through it, so importing `IntegrityHash` would retain the HTTP client and the subprocess runner.

`__test__/reachability.test.ts` asserts both from the source graph, and it is proven to fail when violated. **Do not weaken it**, and do not "tidy" `index.ts` into a namespace.

**The escalation, if it ever comes:** the moment either service takes a *non-core* runtime dependency (a registry SDK, a tarball reader), this package becomes **integrated** and R2 *does* propagate — dragging `lockfiles` (pure!) and `package-json` with it. The answer then is to split the services into their own package, not to accept an integrated npm. Re-check the tier before adding any dependency.

## Exported surface

`src/index.ts` is the only re-exporting module. The original resolver contracts, plus the shared dependency vocabulary that relocated here as second consumers materialized:

- `CatalogResolver` (`src/CatalogResolver.ts`) — `Context.Service`. `rangeOf(packageName, catalog: Option<string>)` returns the configured range; `Option.none()` for `catalog` selects the default catalog. Error channel is `CatalogAssemblyError | DependencyResolutionError`. Ships `CatalogResolver.noop`.
- `WorkspaceResolver` (`src/WorkspaceResolver.ts`) — `Context.Service`. `versionOf(packageName)` returns the concrete version, range modifier stripped. Ships `WorkspaceResolver.noop`.
- `DependencyResolutionError` (`src/WorkspaceResolver.ts`) — `Schema.TaggedErrorClass` with `specifier: Schema.String` and `cause: Schema.Defect()`. Both resolvers raise it.
- `CatalogAssemblyError` (`src/CatalogAssemblyError.ts`) — the typed failure of catalog *assembly* (`source: manifest | catalog | hooks`), relocated from `@effected/workspaces` so the `CatalogResolver` contract can name it in its channel instead of a defect `cause` consumers had to `_tag`-sniff. `@effected/workspaces` deliberately does **not** re-export it — import it from here.
- `Default` (`src/index.ts`) — `Layer.mergeAll` of both `noop` layers.
- `Manifest` (`src/Manifest.ts`) — a **tolerant** manifest `Schema.Class`: the four dependency fields typed, everything else preserved verbatim in `rest` (flattened back on encode — no literal `rest` key on the wire). Static `schema` is the wire codec; static `decode` normalizes `SchemaError` to `ManifestDecodeError`; the pure `needsResolution` getter is the skip-catalog-assembly fast path; instance `resolve()` projects every `catalog:`/`workspace:` specifier through the two contracts into a new `Manifest` (an alias form resolves the **target**'s version; `UnresolvedDependencyError.dependency` names it); `toRecord()` encodes back. A specifier the resolvers answer with `Option.none()` fails typed as `UnresolvedDependencyError` — at the manifest level "no entry" *is* a failure. Deliberately not `@effected/package-json`'s strict `Package`: mid-build manifests are arbitrary user records.
- `DependencySpecifier` (`src/DependencySpecifier.ts`) — the specifier concept relocated from `@effected/package-json`: a branded string with eleven-protocol taxonomy statics (`protocolOf` and friends), the resolution statics `catalogNameOf`, `resolveWorkspace` (the pnpm publish-time projection; the alias form `workspace:<alias>@<range>` — last-`@` split, scoped-aware — projects to `npm:<name>@<projected>`) and `workspaceTargetOf` (the alias target name, `None` for the plain form), plus a `FromString` codec decoding to a coarse five-case tagged union (`CatalogSpecifier` | `WorkspaceSpecifier` | `RangeSpecifier` | `DistTagSpecifier` | `RawSpecifier`, matchable as `ClassifiedSpecifier`) that encodes back **byte-for-byte**. `WorkspaceSpecifier#resolve(version)` applies the same projection to an already-classified instance — one shared implementation. Range detection decodes `@effected/semver`'s `Range.FromString` purely — the only use of the workspace edge. Also `InvalidDependencySpecifierError`, `isValidDependencySpecifier`.
- `DependencySection` (`src/DependencySection.ts`) — the kit-wide dependency-section vocabulary: `DependencyKind` (`prod`/`dev`/`peer`/`optional`) and `DependencyField` (the four manifest key names) as literal schemas, plus the bidirectional `fieldOf`/`kindOf` mapping. Replaces the private copies package-json, lockfiles and workspaces each carried.
- `IntegrityHash` (`src/IntegrityHash.ts`) — a brand over the three textual integrity forms: SRI (`<algo>-<base64>`), corepack (`<algo>.<hex>`) and yarn (`10c0/<hex>`). `algorithmOf` is `None` for the yarn form, which names no algorithm. Also `InvalidIntegrityHashError`, `isValidIntegrityHash`.
- `NpmRegistry` (`src/NpmRegistry.ts`) — registry reads over core `HttpClient`, replacing every shelled `npm view`. `version` / `versions` / `distTags` / `publishTimes`, each taking a **per-call** `RegistryTarget` (`{ registry?, token? }`). Three things are load-bearing: the registry is per-call because a publish flow probes two registries for one package in one program; a **404 is `Option.none()`**, decided on the status rather than by matching npm's stderr wording; and `integrity` is typed as this package's `IntegrityHash`. `RegistryReadError` routes on `kind: transport | status | decode`. Two doubles: `layerTest(Partial<Shape>)` (unstubbed members die) and `layerSeeded(RegistrySeed)` — a working fake keyed **`registries[registry][name][version]`**, which is the shape the v3 double lacked (it keyed by package name alone and broke two consumer suites).
- `PackagePublish` (`src/PackagePublish.ts`) — `setupAuth` / `pack` / `publishTarball` / `dryRun` over `@effected/commands`' `Run`. The auth token is written to a **caller-supplied npmrc path, never argv**; masking is the caller's job (no `ActionOutputs` edge). `pack` reports both digests and they are **not interchangeable**: `integrity` is npm's sha512 SRI (compares to the registry), `sha256Hex` is a local hex sha256 (the attestation subject). A failed `dryRun` is a **result**, not an error.
- `NpmExecutor` (`src/NpmExecutor.ts`) — `ambient` or `dlx(spec)`, replacing v3's five repeated `packageManager?:` options. `dlx` runs through `LocalExec.applyDlx` (`pnpm dlx npm@11 …`) because OIDC trusted publishing needs npm ≥ 11.5.1 and runners ship 10.x. With no launcher it **fails typed** rather than degrading to ambient npm — degrading reintroduces the exact bug the pin exists to avoid.
- `PublishError` (`src/PublishError.ts`) — its own module because both `NpmExecutor` and `PackagePublish` raise it. `kind: auth | pack | publish | output | digest | executor`. `"digest"` exists because npm succeeding while the tarball cannot be read back is not "npm pack failed".
- `RegistryKind` / `classifyRegistry` (`src/RegistryKind.ts`) — `npm | github-packages | jsr | custom`, replacing four v3 predicates with one exhaustive classification. Subdomain matching requires a leading dot (`evil-npmjs.org` is **custom**, and that call decides whether a token is sent). v3's `getRegistryDisplayName` was **dropped**: consumers disagree on the strings (`"GitHub Packages"` vs `"github"` from the same input), so they switch on the kind and choose their own.
- `ReleaseAgeGate` / `PartialReleaseAgeGate` (`src/ReleaseAgeGate.ts`) — the minimum-release-age gate vocabulary. `ReleaseAgeGate` is a `Schema.Class` (an `ageMinutes` value plus an `exclude` set); statics `combine` (variadic, **strictest-wins** — the single clamping authority) and `matchesExclude` (flat-`*` @pnpm/matcher parity, deliberately **not** `@effected/glob`'s dialect); instance `isExcluded` / `filterVersions` are pure and take the caller's clock, **dropping** versions with a missing or unparseable timestamp. `PartialReleaseAgeGate` is the permissive `Schema.Struct` inbound form (hook/manifest contributions); it is `combine`d into a clamped `ReleaseAgeGate` — never clamped in isolation.

Consumers today are `@effected/package-json` (`Package.resolve`, and re-exporting `DependencySpecifier`), `@effected/lockfiles`, and `@effected/workspaces`. Arrows point *at* this package; the only outbound edge is the pure `@effected/semver` peer.

## Invariants

- **An unmatched specifier is `Option.none()`, not an error** at the contract level. `DependencyResolutionError` is reserved for failure of the resolution *mechanism*; `CatalogAssemblyError` for failure to assemble the catalogs. At the **manifest** level, `Manifest.resolve()` turns that `Option.none()` into a typed `UnresolvedDependencyError` — the manifest cannot be projected. Do not blur these three.
- **`cause` stays structured.** Never fold it into a string.
- **`Schema.Defect` must be called** — `Schema.Defect()`. The bare value throws at construction.
- **Layers bind to consts, never getters** — a getter mints a fresh layer per access and defeats memoization.
- **`DependencyResolutionError` lives in `WorkspaceResolver.ts`** and **`CatalogAssemblyError` in its own module**; `CatalogResolver.ts` type-imports both. That keeps the single runtime edge `CatalogResolver → WorkspaceResolver` and satisfies `noImportCycles`, so `Default` lives in `index.ts`, the cycle-free home.
- **Never spread an `optionalKey` field in as explicit `undefined`** — v4 constructors validate; `Manifest.resolve` uses conditional spreads.
- Only `src/index.ts` re-exports. No barrel files.

## How it grows

`@effected/workspaces` landed and implements both contracts (`WorkspaceCatalogs.catalogResolver`, `WorkspaceDiscovery.workspaceResolver`); its `Workspaces.resolverLayer` / `Workspaces.resolveManifest` are the batteries-included path over `Manifest`.

`@effected/lockfiles` was the second consumer that pulled `DependencySpecifier`, `DependencyField` and `IntegrityHash` here; `package-json` now re-exports `DependencySpecifier` rather than owning it. `PackageName` stays in `@effected/package-json` until a second consumer materializes. Do not pre-claim the pnpm `catalogs:` record shape — that routes to `@effected/lockfiles`.

The release-age gate vocabulary (`ReleaseAgeGate` / `PartialReleaseAgeGate`) landed here as the pure home for the contract `@effected/workspaces` surfaces (`WorkspaceCatalogsShape.releaseAgeGate`, `HookInjection.releaseAge`) but cannot own.

## Testing and building

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — never `expect`. Provide layers via top-level `layer(...)` grouping, not per-test `Effect.provide`. Each contract has a **stub-implementation layer** test proving it is implementable — the pattern real consumers follow. Stubs build `Option` results with `Option.fromUndefinedOr`; `Option.fromNullable` is gone in v4. Currently 166 tests across 11 files.

```bash
pnpm vitest run packages/npm          # 166 tests
pnpm build --filter @effected/npm     # dev + prod
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.

`savvy.build.ts` **does** suppress `ae-forgotten-export` for the `_base` pattern: every factory-backed class (`Context.Service`, `Schema.Class`, `Schema.TaggedErrorClass`) is written inline per house policy. A clean `dist/prod/issues.json` has empty `warnings`/`errors` and **twenty-three** `suppressed` entries — the two resolver contracts, `DependencyResolutionError`, `CatalogAssemblyError`, the five `DependencySpecifier` union members, the two integrity/specifier validation errors, the three `Manifest` classes (`Manifest`, `ManifestDecodeError`, `UnresolvedDependencyError`), `ReleaseAgeGate`, and the Phase 5 additions (`NpmRegistry`, `PublishedVersion`, `PublishTime`, `RegistryReadError`, `PackagePublish`, `PackedTarball`, `NpmExecutor`, `PublishError`). `suppressed: 0` in the *prod* gate means the build did not run properly. `dist/dev/issues.json` legitimately has `suppressed: []`; the dev target does not run API Extractor.
