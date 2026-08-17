# Vocabulary and contracts — @effected/npm

The resolver contracts, `Manifest`, and the shared dependency vocabulary that
relocated here as second consumers materialized. Surfaces only — the rules that
govern them live in the parent.

**Parent:** [@effected/npm context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/npm.md`

## Contracts

- `CatalogResolver` (`src/CatalogResolver.ts`) — `Context.Service`.
  `rangeOf(packageName, catalog: Option<string>)` returns the configured range;
  `Option.none()` for `catalog` selects the default catalog. Error channel is
  `CatalogAssemblyError | DependencyResolutionError`. Ships
  `CatalogResolver.noop`.
- `WorkspaceResolver` (`src/WorkspaceResolver.ts`) — `Context.Service`.
  `versionOf(packageName)` returns the concrete version, range modifier
  stripped. Ships `WorkspaceResolver.noop`.
- `DependencyResolutionError` (`src/WorkspaceResolver.ts`) —
  `Schema.TaggedError` with `specifier` and `cause: Schema.Defect()`. Both
  resolvers raise it.
- `CatalogAssemblyError` (`src/CatalogAssemblyError.ts`) — the typed failure of
  catalog *assembly* (`source: manifest | catalog | hooks`), relocated from
  `@effected/workspaces` so the `CatalogResolver` contract can name it in its
  channel instead of a defect `cause` consumers had to `_tag`-sniff.
  `@effected/workspaces` deliberately does **not** re-export it — import it from
  here.
- `Default` (`src/index.ts`) — `Layer.mergeAll` of both `noop` layers.

## Manifest

`Manifest` (`src/Manifest.ts`) is a **tolerant** manifest `Schema.Class`: the
four dependency fields typed, everything else preserved verbatim in `rest`
(flattened back on encode — no literal `rest` key on the wire). Static `schema`
is the wire codec; static `decode` normalizes `SchemaError` to
`ManifestDecodeError`; the pure `needsResolution` getter is the
skip-catalog-assembly fast path; instance `resolve()` projects every
`catalog:`/`workspace:` specifier through the two contracts into a new
`Manifest` (an alias form resolves the **target**'s version;
`UnresolvedDependencyError.dependency` names it); `toRecord()` encodes back.

Deliberately not `@effected/package-json`'s strict `Package`: mid-build
manifests are arbitrary user records.

## Shared vocabulary

- `DependencySpecifier` (`src/DependencySpecifier.ts`) — the specifier concept
  relocated from `@effected/package-json`: a branded string with
  eleven-protocol taxonomy statics (`protocolOf` and friends), the resolution
  statics `catalogNameOf`, `resolveWorkspace` (the pnpm publish-time projection;
  the alias form `workspace:<alias>@<range>` — last-`@` split, scoped-aware —
  projects to `npm:<name>@<projected>`) and `workspaceTargetOf` (the alias
  target name, `None` for the plain form), plus a `FromString` codec decoding to
  a coarse five-case tagged union (`CatalogSpecifier` | `WorkspaceSpecifier` |
  `RangeSpecifier` | `DistTagSpecifier` | `RawSpecifier`, matchable as
  `ClassifiedSpecifier`) that encodes back **byte-for-byte**.
  `WorkspaceSpecifier#resolve(version)` applies the same projection to an
  already-classified instance — one shared implementation. Range detection
  decodes `@effected/semver`'s `Range.FromString` purely — the only use of the
  workspace edge. Also `InvalidDependencySpecifierError`,
  `isValidDependencySpecifier`.
- `DependencySection` (`src/DependencySection.ts`) — the kit-wide
  dependency-section vocabulary: `DependencyKind` (`prod`/`dev`/`peer`/
  `optional`) and `DependencyField` (the four manifest key names) as literal
  schemas, plus the bidirectional `fieldOf`/`kindOf` mapping. Replaces the
  private copies package-json, lockfiles and workspaces each carried.
- `IntegrityHash` (`src/IntegrityHash.ts`) — a brand over the three textual
  integrity forms: SRI (`<algo>-<base64>`), corepack (`<algo>.<hex>`) and yarn
  (`10c0/<hex>`). `algorithmOf` is `None` for the yarn form, which names no
  algorithm. Also `InvalidIntegrityHashError`, `isValidIntegrityHash`.
- `CorepackIntegrityHash` (`src/IntegrityHash.ts`) — the **one** home for the
  corepack-only narrowing of that brand (`<algo>.<hex>`, sha224 included). Both
  surfaces that model a pin tail consume it: `PackageManagerPin.integrity` here
  and `@effected/package-json`'s `PackageManager.integrity`, which each carried
  a private copy until the 2026-07-28 consolidation. The identity assertions
  that protect the sharing are `PackageManagerPin.fields.integrity.schema ===
  CorepackIntegrityHash` (an `optionalKey` keeps the inner schema on `.schema`)
  and `PackageManager.fields.integrity.value === CorepackIntegrityHash` (a
  `Schema.Option` keeps it on `.value`). Both fire on a faithful re-fork
  ("compared values have no visual difference" — that IS the point). It also
  carries the **SRI bridge**: the `FromSri` codec (npm's `sha512-<base64>` in,
  corepack form out, one layer of JSON quotes tolerated), the `fromSri` `Effect`
  convenience and `InvalidSriIntegrityHashError`. The rule is in the parent.
- `PackageManagerPin` / `PackageManagerPinName` (`src/PackageManagerPin.ts`) —
  the corepack pin triple `<name>@<version>[+<integrity>]` as a first-class
  `Schema.Class`, independent of any package.json field: `name` is a
  four-literal union structurally mirroring `@effected/workspaces`'
  `PackageManagerName` (never imported — that edge would invert tiers),
  `version` is `@effected/semver`'s `SemVer` restricted to empty build metadata,
  `integrity` an `optionalKey` corepack-form `IntegrityHash`. `FromString` codec
  plus the `parseResult`/`parse` pair (the sync `Result` is the primitive).
  Failures are `InvalidPackageManagerPinError`,
  `reason: format | name | version | integrity`. Prereleases are pinnable;
  ranges, partials and dist-tags are not. `@effected/package-json`'s
  `PackageManager.FromString` parses the same grammar and shares both strict
  pieces: the string-level version ruling (`SemVer.isPinnable` since the
  2026-08-02 migration — a padded substring like `pnpm@ 11.17.0` fails typed
  with `reason: "version"`, where a bare `SemVer.parseResult` check trims and
  silently canonicalizes) and `CorepackIntegrityHash`. The name-grammar
  divergence is evidence-backed in both modules' TSDoc: corepack 0.34.0
  (`specUtils.ts`) supports only npm/pnpm/yarn and rejects `bun@1.2.20`, which
  is real in the wild; corepack skips its own name check for URL specs; npm
  documents no constraint on the field.
- `PackageManagerCache` / `CachingPackageManager` (`src/PackageManagerCache.ts`)
  — the per-manager default-cache-directory **facts table**:
  `defaultDirectory(manager, { platform, home })`, pure, no IO and no
  `node:path` (paths are joined with the platform family's separator). Five rows
  — the yarn pair is split into `yarn-classic` / `yarn-berry` because the two
  lines document different cache locations. Every cell is verified against the
  manager's own authority, cited in the member's TSDoc (npm docs `cache`, pnpm
  `storeDir`, yarn v1 `user-dirs.js`, Berry `folderUtils.ts` + `cacheFolder`,
  bun's global-cache docs — the last correcting prior art's Windows `AppData`
  row). `$PNPM_HOME`, `$XDG_*` and `$BUN_INSTALL_CACHE_DIR` are deliberately out
  of scope; the tests pin every cell.
- `ReleaseAgeGate` / `PartialReleaseAgeGate` (`src/ReleaseAgeGate.ts`) — the
  minimum-release-age gate vocabulary. `ReleaseAgeGate` is a `Schema.Class` (an
  `ageMinutes` value plus an `exclude` set); statics `combine` and
  `matchesExclude` (flat-`*` @pnpm/matcher parity, deliberately **not**
  `@effected/glob`'s dialect); instance `isExcluded` / `filterVersions` are pure
  and take the caller's clock, **dropping** versions with a missing or
  unparseable timestamp. `PartialReleaseAgeGate` is the permissive
  `Schema.Struct` inbound form (hook/manifest contributions).

## Consumers, and how it grows

Consumers today are `@effected/package-json` (`Package.resolve`, and
re-exporting `DependencySpecifier`), `@effected/lockfiles` and
`@effected/workspaces`. Arrows point *at* this package; the only outbound edge
is the pure `@effected/semver` peer.

`@effected/workspaces` implements both contracts
(`WorkspaceCatalogs.catalogResolver`, `WorkspaceDiscovery.workspaceResolver`);
its `Workspaces.resolverLayer` / `Workspaces.resolveManifest` are the
batteries-included path over `Manifest`. It also surfaces the release-age
contract (`WorkspaceCatalogsShape.releaseAgeGate`, `HookInjection.releaseAge`)
that it cannot own, which is why the gate vocabulary lives here.

`@effected/lockfiles` was the second consumer that pulled `DependencySpecifier`,
`DependencyField` and `IntegrityHash` here. `PackageName` stays in
`@effected/package-json` until a second consumer materializes. Do not pre-claim
the pnpm `catalogs:` record shape — that routes to `@effected/lockfiles`.
