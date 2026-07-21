---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-20
last-synced: 2026-07-20
completeness: 96
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - glob.md
  - workspaces.md
  - npm.md
---

# @effected/lockfiles design

## Overview

`@effected/lockfiles` is lockfile parsing as pure string→model decoding — a **pure-tier** package. It holds the four package-manager lockfile parsers (bun `bun.lock` JSONC, npm `package-lock.json` v2/v3, pnpm `pnpm-lock.yaml`, yarn Berry `yarn.lock`), the unified `Lockfile` model they all normalize into, and pure integrity checking of that model against workspace manifests.

Its consumer is [`@effected/workspaces`](workspaces.md), whose `LockfileReader` service (root find + PM detect + file read + dispatch) stays there and consumes this package. It is on the [release gate](../releases.md#the-gate) because workspaces reads lockfiles and downstream tooling consumes workspaces transitively.

## Tier and dependencies

**Pure tier.** No services, no layers, no IO, no `R` anywhere. A lockfile parser that reached for the filesystem would be boundary tier, so the IO stays out by construction: every entrypoint takes `content: string`, and integrity checking takes manifests as input rather than reading them.

Peer closure per the standing precedent — each edge declared in both `peerDependencies` and `devDependencies`. Peers are `effect` (`catalog:effect`) plus four pure-to-pure `workspace:~` edges: `@effected/jsonc` (bun's JSONC), `@effected/yaml` (pnpm and yarn Berry are YAML), `@effected/semver` (integrity's range satisfaction) and `@effected/npm` (the shared `DependencySpecifier`, `DependencyField` and `IntegrityHash` vocabulary). Zero external runtime dependencies — the text-parsing engines arrive through the sibling packages, so unlike glob and toml there is nothing to vendor.

## The two seam properties

Two responsibilities that a naive extraction would split across parser and reader are structural properties of this API instead.

### 1. pnpm importer-path→name resolution is an explicit second stage

pnpm lockfiles name workspace packages by importer *path* with version `"0.0.0"`; the real names live in the `package.json` files. Both stages of the resolution are pure and explicit:

- `Lockfile.parse` emits the honest importer-path-keyed model (pnpm) or the already-name-resolved model (npm, yarn, bun — their lockfiles carry real names).
- `lockfile.withImporterNames(names: ReadonlyMap<string, string>)` — a total, pure instance method — rewrites workspace package names **and** the `from`/`to` ends of workspace dependency edges from an importer-path→name map. Entries not in the map keep their path name; non-pnpm lockfiles are unaffected. The manifest IO that builds the map is workspaces' job.

### 2. Integrity checking is total and pure

`LockfileIntegrity.compare(lockfile, manifests)` takes the manifests as values and returns the report **infallibly** — a plain function, no Effect, no error channel. Unparseable ranges/versions and `workspace:`/`link:`/`file:` specifiers are skipped (constraint checking is best-effort by design), so totality costs no behavior. The method is named `compare`, not `check`, because every v4 `Schema.Class` already carries a reserved `static check(...)` for attaching schema checks — a naming constraint domain statics must dodge.

The manifest input is a minimal structural schema, `WorkspaceManifest` (`name` plus the four optional dependency records) — deliberately *not* `@effected/package-json`'s types, which live in an integrated-tier package this one must not depend on. Structural typing lets workspaces pass values derived from either.

Range satisfaction goes through `@effected/semver`; parse failures on either side skip the row. Integrity keeps every resolved version per name, so a constraint is satisfied when *any* parseable resolved version matches (never dependent on lockfile entry order), and an unsatisfied row reports all candidates.

## Module layout

Module-per-concept, with the value classes as leaf modules so the parser internals and the `Lockfile` dispatcher both import them without cycles (`noImportCycles`). See `src/`:

- `LockfileFormat.ts` — the `Literals("bun","npm","pnpm","yarn")` const plus the module functions `filenameFor` and `fromFilename` (a Literals const cannot carry statics). Filename knowledge is lockfile domain, both directions.
- `ResolvedPackage.ts`, `WorkspaceDependency.ts`, `ImporterDependency.ts`, `LockfileImporter.ts`, `PnpmExtension.ts`, `BunExtension.ts` — the value classes.
- `Lockfile.ts` — the `Lockfile` class, the static `parse` dispatcher, `withImporterNames`, `packagesNamed`, `LockfileParseError` and `LockfileFramingError`.
- `LockfileIntegrity.ts` — the `LockfileIntegrity` class, `static compare` and `WorkspaceManifest`.
- `internal/` — `shared.ts` (workspace-dep extraction, the dependency-sections table), `documents.ts` (the framing rule), and the per-format `bun.ts`/`npm.ts`/`pnpm.ts`/`yarn.ts` transforms.

The per-format **raw schemas stay private** in `internal/`: they are permissive validation scaffolding, not API. Each internal transform returns a raw `ParseFailure { stage, cause }` record on failure — the public `LockfileParseError` (with `format` attached) is materialized by `Lockfile.parse`, keeping the error class in `Lockfile.ts` without an import cycle back into the internals.

## Public surface

See `src/Lockfile.ts` for the full model; the load-bearing shape:

`Lockfile` (a `Schema.Class`) carries `format: LockfileFormat`, `lockfileVersion: string`, `packages: ReadonlyArray<ResolvedPackage>`, `workspaceDependencies`, `importers` (defaulted `[]`), and an optional `extension` (`PnpmExtension | BunExtension`).

- `Lockfile.parse(content, { format }): Effect<Lockfile, LockfileParseError | LockfileFramingError>` — the package's only fallible boundary, wrapped in `Effect.fn("Lockfile.parse")`, dispatching to the internal per-format transform.
- `withImporterNames(names)` — seam property 1.
- `packagesNamed(name)` — multi-version lookup, backed by a lazily built private name index outside the schema.
- `importer(path): Option<LockfileImporter>` — keyed importer access, backed by a lazily built private index; the array field remains for serialization and iteration.
- `workspacePackages` getter.

`ResolvedPackage.integrity` is [`@effected/npm`'s `IntegrityHash`](npm.md#integrityhash) brand (an unparseable checksum is dropped, never thrown — the brand's yarn `<cachekey>/<hex>` form is what keeps yarn Berry's cache checksums from silently vanishing). `WorkspaceDependency.depType` and integrity's `unsatisfiedConstraints[].depType` use npm's `DependencyField`. `PnpmExtension.ts` also exports the `PnpmCatalogs` record type, so workspaces' `CatalogSet.fromLockfileCatalogs` types against it instead of re-declaring the shape.

### LockfileParseError

One error class, a `Schema.TaggedErrorClass` with `format: LockfileFormat`, `stage: Literals("syntax", "validation")` (text-level parse failure vs schema-shape failure) and `cause: Schema.Defect` preserving the underlying jsonc/yaml/JSON/Schema error. Malformed input is a recoverable typed failure, never a defect. It carries no path field — parse takes content, not a path, and the caller that did the IO owns the path context. `LockfileReadError` (IO) stays in workspaces with the `LockfileReader` service.

## Document framing: a lockfile is a YAML *stream*

A lockfile is not always one YAML document. pnpm writes `pnpm-lock.yaml` as **two YAML documents** when the workspace uses `configDependencies`: a config-dependencies ("env") preamble, then the lockfile. Both documents declare `lockfileVersion`, `importers` and `packages`, so the preamble validates cleanly against the pnpm schema — a single-document parse would *succeed* and return a `Lockfile` with one package and no workspace importers, reporting an apparently empty workspace. That silent success is the defect this rule closes.

**The framing rule is deterministic, not a heuristic.** pnpm's own writer composes the file as env-prefix followed by the main document, so the preamble is always a *prefix*, never a suffix: **the lockfile is the LAST document, by the writer's contract.** `src/internal/documents.ts` owns this. No structural rule would work — both documents carry the same keys, so "document with importers wins" picks the preamble just as happily; position is the only sound discriminator. Selection is done over the parsed stream by position, which additionally keeps readable a normalized single-document lockfile that carries a leading marker (which pnpm's own byte-sniffing rule would misread as env-only).

An unlocatable lockfile fails typed and can never return an empty `Lockfile`. `LockfileFramingError` carries `format`, `documents` and `reason` and **no `cause`** — the text parsed fine, so there is no foreign throwable to wrap. Its `reason` is `noLockfileDocument`, `noImporters` or `unexpectedDocuments`.

The other three parsers were checked, not assumed. yarn shares the YAML shape but defines no document framing, so a multi-document `yarn.lock` fails typed rather than being silently truncated to its first document — where the format states no rule, this package refuses to guess. npm and bun never share the hazard, because a second top-level value is a syntax error in both `JSON.parse` and `Jsonc.parse`; the suite pins that.

The transferable lesson, mutation-checked in the suite: **a parser that succeeds on the wrong input is worse than one that fails**, and "empty result" is the most dangerous success shape because it is indistinguishable from a legitimate empty answer.

## Importers

The `importers` field records each workspace importer's *declared* dependencies — the data a before/after lockfile diff needs (its driving consumer is silk-update-action, which parses two texts through the pure boundary and compares importers per process). Two leaf value classes back it:

- **`ImporterDependency`** — one declared dependency: `name`; `specifier` as [`@effected/npm`'s `DependencySpecifier`](npm.md#dependencyspecifier) via its `FromString` codec, so a decoded value is tag-matchable while **encoding round-trips the exact original string** (the brownfield guarantee); an optional `version`, **pnpm-only** (pnpm records `{ specifier, version }` per importer dependency; bun and npm record resolved versions on package entries, so consumers join by `name` against `packages`); and `depType` as npm's `DependencyField`.
- **`LockfileImporter`** — `path` (root-relative, `"."` for the root — the same keys as `WorkspaceDiscovery.importerMap()`) plus `dependencies`.

The pnpm, bun and npm transforms populate `importers` off a shared dependency-sections table; **yarn always yields `[]`**, documented behavior since yarn never records importers. `withImporterNames` deliberately does not touch importers — they stay keyed by importer path, the join key. Construction uses conditional spreads for the optional `version`, since v4's validating constructors throw on an explicit `undefined` for an `optionalKey` field.

The specifier taxonomy comes from `@effected/npm` rather than `@effected/package-json`: that package is integrated tier, and R2 would propagate integration into this pure package. See the [npm vocabulary registry](npm.md#vocabulary-registry) for what this package keeps and discards from each lockfile format.

## Hardening

[hardening-a-parser-port](../effect-standards.md#input-hardening-standards) applies, and this package's position is unusually good: **it adds no new text-parsing engine and no new recursion surface.** Text parsing is delegated — bun to `@effected/jsonc`, pnpm/yarn to `@effected/yaml` (both already hardened), npm to native `JSON.parse` inside `Effect.try` (its throw on hostile input lands in the typed channel as `stage: "syntax"`). The transforms are single-pass iterations over flat records.

What the transforms still owe:

- **Prototype-pollution discipline.** Lockfile keys are attacker-adjacent strings (`__proto__`, `constructor`). Key-bearing intermediates stay `Map`s; decoded `Schema.Record` fields come from schema decode, not manual assignment; the hostility suite proves a `__proto__` key neither pollutes nor crashes. (v4 `Schema.Record` decode preserves a `__proto__` key as an own property with `Object.prototype` unpolluted.)
- **Total string surgery.** The `name@version` splitters, yarn's descriptor extractors and dependency cleaners stay total — malformed keys are *skipped* or fail validation, never throw. Rows that would construct a `NonEmptyString` from `""` are skipped, since v4's validating construction would otherwise turn malformed input into a defect at `make`.
- **Scope honesty.** Yarn support is Berry only. Classic (v1) `yarn.lock` is not YAML; whether it happens to YAML-parse or not, it must exit through `LockfileParseError`, never mis-normalize — a fixture pins this.

## Observability

Pure-tier house rule: a named `Effect.fn` span on the public fallible boundary — `Lockfile.parse` — and nothing else. `LockfileIntegrity.compare`, `withImporterNames` and `packagesNamed` are total and span-free. Operational logging belongs to workspaces' `LockfileReader`, which owns the IO story. No metrics, telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. No platform packages, no mock layers, no TestClock. Families:

1. **Per-format fixture tests** — the fixture corpus (pnpm/npm/yarn/bun across their lockfile versions) asserted against the unified model: package identification, integrity, workspace dependency edges and extension payloads.
2. **Seam-property tests** — `withImporterNames` renames pnpm workspace packages and rewrites both edge ends while leaving unmapped and non-pnpm entries untouched (including that importers stay untouched); `LockfileIntegrity.compare` covers valid / missing / extra / unsatisfied / skip cases, fed by in-memory manifests (no IO anywhere in the suite).
3. **Hostility suite** — malformed text → `stage: "syntax"`; wrong shape → `stage: "validation"`; yarn classic content; `__proto__`/`constructor` keys; hostile `name@version` keys; deep-nesting bombs proving the delegated engines' typed failures surface through `LockfileParseError`. The document-framing tests are mutation-checked (reverting the framing rule or disabling a guard turns them red).
4. **Codec round-trips** — `it.effect.prop` over `Schema.toArbitrary`-derived values, encode∘decode identity, since the model is API for serialization consumers (workspaces snapshots).

## Build and scaffold

Per [package-setup.md](../package-setup.md): scaffolded from a pure sibling with `workspace:~` peers, model paths under `website/lib/models/lockfiles`. The model classes and error classes are class factories, so `savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). Because it has `workspace:~` peers, the package needs a `prepare` script so turbo's `^build:dev` orders the upstream builds ahead of it.

## Consumer contract

[`@effected/workspaces`](workspaces.md)' `LockfileReader` finds the root, detects the PM, reads the file (`LockfileReadError` stays there) and calls `Lockfile.parse` **directly** — document framing is this package's job, not the reader's. For pnpm it then reads the workspace manifests and applies `withImporterNames`; integrity is manifest IO plus `LockfileIntegrity.compare`; resolved version lookup is `packagesNamed(name)[0]`. Workspaces defines its own `PackageManagerName` literal rather than aliasing `LockfileFormat`: the two are structurally identical and assign freely, but they are different concepts (which manager drives this workspace, versus which lockfile grammar to parse), and a separate name avoids colliding with `@effected/package-json`'s `PackageManager` in a consumer's imports.

## Open items

- **Importer-name map carries names only.** pnpm workspace packages keep version `"0.0.0"` after `withImporterNames` (the reader never fixed versions either). If a consumer wants real versions in the model, the map value can widen to `{ name, version? }`; not speculated now.
- **Bun package-tuple shape** is under-documented upstream (integrity assumed at tuple index 3). The permissive reading is kept, pinned by a fixture from a current bun release.
