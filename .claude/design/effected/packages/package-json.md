---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-12
last-synced: 2026-07-12
completeness: 92
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - semver.md
  - jsonc.md
  - yaml.md
  - npm.md
---

# @effected/package-json design

## Overview

Target design for `@effected/package-json`, the **fourth** package migration (step 2 of [migration-playbook.md](../migration-playbook.md), playbook target #4 after semver, jsonc and yaml) and the first port to exercise the [services-and-layers standards](../effect-standards.md#services-and-layers-standards) and the pure/IO boundary discipline in anger. Source is package-json-effect (`/Users/spencer/workspaces/spencerbeggs/package-json-effect`, v0.3.0, Effect v3); the step-1 analysis is `.claude/reviews/package-json.md` and this design implements its §3 v4-mapping, §4 layout, §5 split recommendation and §6 tier findings against [effect-standards.md](../effect-standards.md).

Reclassified 2026-07-09 under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): this doc was drafted and the package shipped under the old two-tier pure/boundary split, at which point it was "the first boundary-tier migration." Under three tiers it is **integrated** — see [Tier and dependencies](#tier-and-dependencies) — because it carries the `spdx-expression-parse` runtime dependency, which the old scheme permitted under "boundary" but the new scheme reserves for tier 3. The design and port narrative below still describes the IO-boundary discipline (`PackageJsonFile` as the sole IO module) accurately; only the tier label changed.

Like the three pure ports before it, this is a redesign, not a lift-and-shift, and the migration is **v4-native throughout — no v3 pattern is preserved merely because v3 shipped it** (the guiding directive for this port). What survives: the `Package` rich-`Schema.Class` DX with computed getters and immutable-mutation statics, the round-trip-fidelity `rest` catch-all + wire transform + `.extend()` story, semantic field decoding (`version`→`SemVer`, `packageManager`, `person`, SPDX `license`, branded names), the dependency-specifier protocol taxonomy, the swappable resolver seams for workspaces-effect, and the message-as-getter error ergonomics. What does not: the kind-based `domain/ schemas/ errors/ services/ layers/` sprawl, the `PackageJson*` prefix noise and `*Schema` suffix gymnastics, the 20-export `*Base` error ceremony, the four copy-pasted dependency classes (~230 duplicated lines), the two-sources-of-truth specifier classification, the `./schema` second entry point, the `Effect.runSync`-in-getters anti-pattern, and the plain-vitest harness.

Because this is the first port to do real IO, its **primary flywheel deliverable** ([migration-playbook.md](../migration-playbook.md) step 6) is a distilled IO-boundary skill set: the `Context.Service`/layer idiom applied to a real IO service, the "provide platform at the edge" discipline, and the pure/IO seam that keeps IO confined to one module. Those lessons feed the "effective" plugin (see [plugin.md](../plugin.md)) the way the parser-hardening lessons did for jsonc/yaml.

This port also spins out a **new sibling package, `@effected/npm`** ([npm.md](npm.md)) — a pure-tier home for the dependency-resolution contracts (`CatalogResolver`, `WorkspaceResolver`, `DependencyResolutionError`) that package-json defines-but-cannot-implement. This is a deliberate, roadmap-driven extraction (not the project's usual defer-until-second-consumer default): the maintainer has downstream uses beyond package-json queued, so the contracts get their own package now rather than living in package-json and being lifted later. Its initial surface is exactly what package-json's port needs; `@effected/workspaces` has since landed and implements those contracts (see [npm.md](npm.md)). package-json takes a `workspace:*` edge to it.

Status: **merged.** The open decisions the review left standing were resolved as recorded below; the three DX decisions the user ruled on directly are in [resolved decisions](#resolved-decisions). The port landed with all gates passing — tests, typecheck, biome and a zero-warning `dist/prod/issues.json` — and the v3 kind-based tree collapsed to concept modules. This doc records the *as-built* design; per the semver/jsonc/yaml precedent it is promoted to `current` with a raised completeness and inline "As-built:" notes woven into the sections below, each resolving a verify-at-port-time item the pre-port draft left open.

## Resolved decisions

Three DX decisions were ruled on before drafting; they are load-bearing for the whole public surface:

1. **Omissible fields decode via `Schema.optionalKey`** (the [schema standard](../effect-standards.md#schema-standards) default), not the v3 `Schema.optionalWith(X, { as: "Option" })` Option-everywhere model. `Schema.Option`-typed decoded fields are reserved for the **few** fields whose absence is actively computed on (e.g. `PackageManager.integrity`), decided per-field at port time. This is the v4-native reading — the directive was explicitly "v4 only semantics," so the 15+ blanket Option-wrapped fields collapse to plain optional keys.
2. **Dependency maps stay `HashMap`** (`HashMap<string, Dependency>` for `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`, and the equivalent for `scripts`). Immutable, Effect-idiomatic, structural-equality for free; consumers use `HashMap.get(pkg.dependencies, "effect"): Option<Dependency>`. This is a deliberate collection choice and is orthogonal to decision 1 — a keyed collection is idiomatically `HashMap`; an omissible scalar field is idiomatically an optional key.
3. **`@effected/semver` is a regular `workspace:*` dependency**, not a peer — `SemVer` instances appear in `Package`'s public API but consumers overwhelmingly read the decoded value rather than construct their own, so version-identity skew across the boundary is not a concern that warrants a peer.
4. **The resolver contracts extract into `@effected/npm`** ([npm.md](npm.md)) rather than living in package-json. `Package.resolve` still requires `CatalogResolver | WorkspaceResolver` from context, but those tags (and `DependencyResolutionError`) are now *imported from* `@effected/npm`, a `workspace:*` regular dependency. Rationale and the alternatives weighed (keep in package-json / move resolution wholesale to workspaces) are in [resolution belongs to @effected/npm](#resolution-belongs-to-effectednpm).

## Tier and dependencies

**Integrated tier — one package, IO confined to a single module** (review §5, ratified; tier reclassified 2026-07-09, see [above](#overview)). The v3 split motivation (the `@effect/platform` peer leaking onto pure consumers) evaporates in v4 because `FileSystem`/`Path` live in `effect` core: the pure core and a hypothetical fs package would have the *identical* peer closure (`effect`), so only the tier label distinguishes them. Splitting would isolate ~115 lines of IO behind paired versioning, a workspace edge and doubled release surface — not worth it. **All IO stays confined to `PackageJsonFile`**; `sideEffects: false` lets bundlers tree-shake the fs code out of pure usage. The package's tier is **integrated**, not because of that IO (which alone would be boundary) but because of the `spdx-expression-parse` runtime dependency below — under [R1](../effect-standards.md#dependency-policy) any runtime import outside `effect` core makes a package tier 3, and this is the only `@effected` package that carries one.

- `peerDependencies`: `effect` only (`catalog:effect`). The v3 `@effect/platform` peer **disappears** — FileSystem is core.
- `dependencies`: `@effected/semver` (`workspace:*`, decision 3); `@effected/npm` (`workspace:*`, decision 4 — the resolver contracts); `spdx-expression-parse` (the runtime dependency that sets the tier — its hand-written `.d.ts` shim comes along under `types/` or is vendored into `src/internal/`).
- `devDependencies`: `effect` and `@effect/vitest` (`catalog:effect`); `@effect/platform-node` (`catalog:effect` — for `it.effect` integration tests that provide a real `FileSystem`); `@types/node`, `typescript` (`catalog:silk`).
- Target directory: `packages/package-json`. `"sideEffects": false`.

**Peer closure check.** `effect` has no peers; `@effected/semver` and `@effected/npm` each declare only `effect` as a peer, which this package re-declares — the closure holds, no transitive peer escapes to consumers (the systems#228 / vitest-agent#127 failure mode is avoided). `@effect/platform-node` stays devDependencies-only; consumers of the file API provide their own platform implementation at the edge. `effect`-only peers, two internal `workspace:*` edges (`@effected/semver`, `@effected/npm`) and exactly one non-effect regular dependency (`spdx-expression-parse`) — the smallest possible integrated-tier footprint.

## Module layout (module-per-concept)

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept), the 34-file kind-based tree (`domain/` 6, `schemas/` 15, `errors/` 10, `services/` 7, `layers/` 8) collapses to ~14 public concept files plus an `internal/` directory. Each concept file owns its `Schema.Class` model(s), the errors that concept raises (`Schema.TaggedErrorClass`), and — if it is a service — the `Context.Service` class plus its layer(s).

~~~text
src/
  index.ts                 # public surface, re-exports only (single entry point — ./schema killed)
  Package.ts               # THE core: Schema.Class model, computed getters, dual mutation
                           #   statics (Function.dual + Pipeable), copyWith (derived patch
                           #   type), resolve (static-with-R), the wire transform +
                           #   Package.schema (the .extend() story); PackageDecodeError
  PackageName.ts           # PackageName / ScopedPackageName / UnscopedPackageName brands;
                           #   statics isValid / scope / unscoped / isScoped;
                           #   InvalidPackageNameError
  DependencySpecifier.ts   # brand + SINGLE protocol taxonomy: protocolOf / isGit / isLocal /
                           #   isRange / isTag / isUrl / isWorkspace / isCatalog ... as statics;
                           #   decode helper; InvalidDependencySpecifierError
  Dependency.ts            # ONE Dependency class with kind: "prod"|"dev"|"peer"|"optional"
                           #   + protocol getters written once; UnresolvedDependency guard
  License.ts               # SpdxLicense brand (spdx-expression-parse) + InvalidSpdxLicenseError
  PackageManager.ts        # class + "name@version+integrity" string codec (integrity: Option)
  Person.ts                # class + "Name <email> (url)" shorthand codec — WIRED into
                           #   Package.author / contributors this time
  DevEngines.ts            # DevEngine class + devEngines field schema
  PackageValidator.ts      # Context.Service + layer; ValidationRule interface; defaultRules;
                           #   PackageValidationError (+ RuleFailure); parameterized layer
                           #   factory (rules) — a genuinely-parameterized layer, standards-permitted
                           # (CatalogResolver + WorkspaceResolver contracts now live in
                           #  @effected/npm; Package.resolve imports the tags from there)
  PackageJsonFile.ts       # THE ONLY IO MODULE: one Context.Service, read + write over core
                           #   FileSystem; PackageJsonReadError / NotFoundError / ParseError /
                           #   WriteError; composite convenience layer wiring the defaults
  internal/
    fields.ts              # small anonymous field codecs: bin, engines, exports, publishConfig,
                           #   scripts, dependency-map record<->HashMap
    format.ts              # canonical key order (sort-package-json) + dep sorting + empty-map
                           #   stripping as PURE functions (Formatter/Transformer services
                           #   dissolve; surfaced as write options and Package.toJsonString)
~~~

Consolidation: 34 src files → ~12 (the two resolver modules move to [@effected/npm](npm.md)); 10 error files → errors co-located with their concepts; 7 services → **2 defined here** (`PackageJsonFile`, `PackageValidator`) plus **2 consumed from `@effected/npm`** (`CatalogResolver`, `WorkspaceResolver`); `Formatter`/`Transformer` become pure internal functions surfaced as options. Every non-entrypoint module imports explicitly from defining modules — no barrels, no re-export facades, no suppressed import cycles (the v3 co-location tax disappears because concepts own their errors and layers).

As-built: the tree landed at **13 src files**. The `internal/fields.ts` module is gone — the field codecs became `@public` consts in `Package.ts` (see the [field-codec as-built note](#optional-field-representation)); only `internal/format.ts` survives in `internal/`.

### Single entry point

**Decision, resolved (review §2).** The v3 `.` + `./schema` split is not a real boundary — both entries export the domain classes, domain errors and resolver services; only field-level codecs and `makePackageJsonSchema` are `/schema`-exclusive, and a consumer cannot predict which import a given name comes from. The redesign ships **one entry point** (`src/index.ts`). Field-level codecs that were `/schema`-only become either statics on their owning concept (`Package.schema`, the `.extend()` factory) or `internal/fields.ts` privates never re-exported. No published subpath entry.

## Effect-wrapping policy (package-wide)

The [jsonc/yaml wrapping policy](yaml.md#effect-wrapping-policy-package-wide) applies, adapted for a service-bearing boundary library: **pure synchronous where nothing can fail; `Effect` where the error channel is real (including all service IO); no `Effect.runSync` inside getters, ever.**

- **Pure synchronous** (no `Effect`): computed getters (`isPrivate`, `isScoped`, `isESM`, `hasDependency`), the specifier taxonomy statics (`DependencySpecifier.protocolOf`, `isRange`, …), `PackageName.isValid`/`scope`/`unscoped`, the format/normalize functions, and `Package.toJsonString(options)`. Absence is `Option` (from `HashMap.get`) or a plain optional field, never a wrapping `Effect`.
- **`Effect`** (real typed `E` channel): the effectful mutation statics that validate (`Package.setVersion` → `InvalidVersionError`, `setName` → `InvalidPackageNameError`, `setLicense` → `InvalidSpdxLicenseError`), `Package.resolve` (requires the resolver services), decode-from-unknown (`Package.schema` decode → normalized `PackageDecodeError`), and every `PackageJsonFile`/`PackageValidator` operation.
- The v3 **`Effect.runSync(Effect.option(parseRange(s)))` inside the range getters is deleted** — range detection decodes `@effected/semver`'s `Range.FromString` **purely** (a sync/Option decode, [verify-at-port-time](#v4-api-drift-to-verify-early)), so no effect runs inside a getter. This is the concrete fix the review flagged (§2) and the seam that motivated the pure-range-parse note in [semver.md](semver.md). As-built: implemented as `Schema.decodeUnknownExit(Range.FromString)` + `Exit.isSuccess` — pure, no effect runs, and no `@effected/semver` follow-up was required (see the [DependencySpecifier as-built note](#dependencyspecifier)).

## Target public API

Class-based DX throughout, per the semver north star. The v3 floating functions (`isGitSpecifier`, `protocolOf`, `isValidPackageName`, `parseRangeOption`, …) collapse to statics on their concept class; the `*Schema` suffixes and type-alias re-exports (`PackageNameType`, `SpdxLicenseType`) evaporate because in v4 the class IS the schema.

### Package (the core model)

`Package` is the rich `Schema.Class` — the schema IS the domain class (review §1, "the single best DX pattern in the repo").

- **Computed getters** (pure): `isPrivate`, `isScoped`, `isESM`, `hasDependency(name)`, `getDependencies()`/`getDevDependencies()`/… returning the `HashMap`s.
- **Immutable mutation statics** with the [dual-signature idiom](#dual-signature-statics): `setVersion`, `setName`, `setLicense`, `addDependency`, `removeDependency`, `setScript`, … — data-first, curried and pipeable call styles all work. Effectful ones fail typed (see [error set](#error-set-derived-from-raise-sites)).
- **`copyWith`** takes a patch type **derived from the fields** (`Partial<...>` over all model fields), not the v3 hand-maintained 9-field partial that silently omitted the other half.
- **`resolve`** — the static-with-R that turns `catalog:`/`workspace:` specifiers into concrete ranges using `CatalogResolver | WorkspaceResolver` from context. It is the one place the pure model reaches into DI; that is acceptable (the standard "static method with R" pattern) **provided resolution is not fused into `write`** (see [services](#services-and-layers)).
- **`rest`** catch-all preserving unknown top-level fields across a read/edit/write cycle (see [wire transform](#the-rest-catch-all-wire-transform-and-extend-story)).
- **`toJsonString(options?)`** — the pure serialization path (decode-from-string / encode-to-string with formatting), first-class this time rather than only reachable through the fs-coupled writer (review §5 change 2).
- **`Package.schema`** and the `.extend()` story — the wire transform partitions raw keys against `Class.fields`, so `.extend()`ed subclasses automatically pull new fields out of `rest` into typed members.

Fields modeled (gaps from review §2 closed): `name` (`PackageName`), `version` (`SemVer`), `license` (`SpdxLicense`), `packageManager` (`PackageManager`), `author`/`contributors` (`Person` — **wired in**, no longer falling into `rest`), `repository` (**modeled**, so the `has-repository` validation rule stops poking into `rest`), `bin`/`engines`/`exports`/`publishConfig`/`scripts`/`devEngines`, the four dependency maps, and `rest`.

As-built: `publishConfig` and `repository` are modeled as an **open `Schema.Record`** / **`Union([String, Record])`** respectively, not typed open structs. A typed open struct (`Schema.Struct(fields, indexSignature)`) *runs* in v4 but is **rejected by the typechecker** — it would need `Schema.StructWithRest`, which does not annotate cleanly for the zero-warning `issues.json`. Round-trip fidelity is fully preserved (including `publishConfig.targets`); the only cost is that typed `publishConfig.access` field access is dropped (consumers read it off the open record). The `has-repository` validation rule reads the modeled `repository` field, as designed.

### PackageName

`PackageName` / `ScopedPackageName` / `UnscopedPackageName` brands (the union with the hand-rolled npm-name validator, ported as `.check(...)` + `Schema.brand`). Statics: `isValid(s)`, `scope(name)`, `unscoped(name)`, `isScoped(name)` — absorbing the v3 floating `PackageNameUtil` object. Owns `InvalidPackageNameError`.

As-built: the statics are attached via **`Object.assign`** — a `const` and a `namespace` cannot merge in TS, so the brand const plus its statics are composed with `Object.assign` rather than a declaration merge. The npm name grammar was tightened to **lookahead-free regexes** (first character must not be `.` or `_`) so `Schema.toArbitrary` property tests derive — arguably more correct than v3's lookahead form.

As-built (realignment, 2026-07-08): the `ScopedPackageName` and `UnscopedPackageName` branded types are now exported explicitly as `string & Brand.Brand<"ScopedPackageName">` / `string & Brand.Brand<"UnscopedPackageName">` rather than the type-inferred `typeof X.Type` form — self-documenting on the public surface, resolving to the same type, and matching the `DependencySpecifierBrand` shape. (`SpdxLicense` got the same treatment; see [License](#license--packagemanager--person--devengines).)

### DependencySpecifier

The **single** classification concept, merging v3's two drifting sources of truth (`domain/Dependency.ts` predicates + `schemas/dependency-specifier.ts` validator). Brand + taxonomy statics: `protocolOf(s)` → `range | tag | git | url | npm | file | link | portal | catalog | workspace | unknown`, plus `isRange`/`isTag`/`isGit`/`isUrl`/`isLocal`/`isWorkspace`/`isCatalog` predicates, all pure. `isRange` decodes `Range.FromString` purely (no `Effect.runSync`). Owns the decode helper and `InvalidDependencySpecifierError`.

As-built: statics are attached via **`Object.assign`** (same `const`-plus-`namespace` limitation as `PackageName`). `DependencySpecifierBrand` is typed as `string & Brand.Brand<"DependencySpecifier">` so the `@public` type does not leak the private brand const. **`isRange` is pure via `Schema.decodeUnknownExit(Range.FromString)` + `Exit.isSuccess`** — the `Effect.runSync`-in-getter is gone, and **no `@effected/semver` follow-up was needed** (the design's contingency `Range.parseOption` addition was unnecessary), resolving that verify item.

Relocation (designed 2026-07-14, port pending): the vocabulary trigger recorded in [npm.md](npm.md#dependencyspecifier-v2-expansion-designed-2026-07-14) fired — the lockfiles importers model and the workspaces snapshots are the second and third consumers, and neither may take a package-json edge (integrated tier; R2 would propagate). **`DependencySpecifier` moves to `@effected/npm`**, carrying this as-built taxonomy with it; package-json imports it from there afterward (the pure edge already exists via `DependencyResolutionError`). `PackageName` stays here. Until the port lands, the module layout above remains the as-built reality.

### Dependency

**One** `Dependency` class with a `kind: "prod" | "dev" | "peer" | "optional"` field (plus an optional `isOptional`/`peerMeta` for the peer case), replacing the four near-identical copy-pasted `Schema.TaggedClass`es (~230 duplicated lines, review §2). The 11 protocol getters are written **once**, delegating to `DependencySpecifier`. The `_tag` split bought nothing — nobody pattern-matches the four tags; `Package.getDependencies()` et al. already indicate which map an entry came from. `UnresolvedDependency` stays a type + guard.

### License / PackageManager / Person / DevEngines

- `License.ts` — `SpdxLicense` brand validating real SPDX expressions (`spdx-expression-parse`), incl. `UNLICENSED` and `SEE LICENSE IN`; `InvalidSpdxLicenseError`. As-built (realignment, 2026-07-08): the `SpdxLicense` type exports explicitly as `string & Brand.Brand<"SpdxLicense">`, not `typeof SpdxLicense.Type`.
- `PackageManager.ts` — class parsing `"pnpm@10.x+sha512.abc"` into `name`/`version`/`integrity: Option` with a string codec (integrity is a genuine `Schema.Option` field — absence is computed on). As-built: `integrity` is kept as a genuine `Schema.Option` as designed. The `FromString` codec uses `Schema.instanceOf(PackageManager)` as its `decodeTo` target (decode produces class *instances*, so `instanceOf` is the correct destination — the same v4 fact `YamlDocument.schema` hit).
- `Person.ts` — class parsing `"Name <email> (url)"` into structured fields and encoding back, **now wired into `Package.author`/`contributors`**.
- `DevEngines.ts` — `DevEngine` class + `devEngines` field schema.

### PackageValidator, CatalogResolver, WorkspaceResolver, PackageJsonFile

See [services and layers](#services-and-layers).

## Optional-field representation

Per [resolved decision 1](#resolved-decisions): **`Schema.optionalKey` is the default** for omissible object fields. The v3 `Schema.optionalWith(X, { as: "Option" })` (15+ fields) is the biggest mechanical delta of the port (review §3) and it collapses to bare optional keys, matching the [jsonc/yaml as-built idiom](yaml.md#options-derivation) of "bare `optionalKey` fields with implementation-level `?? default`" that keeps the `@public` base annotations tractable. `Schema.Option`-typed decoded fields survive **only** where a field's presence/absence is actively branched on in the model's own logic — `PackageManager.integrity` is the clear case; each other candidate is a deliberate per-field call recorded as an as-built note. Decoding-defaults (e.g. dependency maps defaulting to empty) use the v4 field-level `decodeTo` default-getter mechanism rather than `Schema.optionalWith({ default })`.

As-built: the field codecs (`BinField`, `DependencyMapField`, `ExportsField`, `PublishConfigField`, `RepositoryField`, `StringMapField`, `PeerDependenciesMetaField`) are **`@public` exported consts in `Package.ts`, not `internal/fields.ts` privates** — this supersedes the design's `internal/fields.ts` plan for these codecs. Two forces drove it: the decoding-default makes the encoded key optional so structural inlining of the codec into the class fields is brittle, and silk's binary release-tag policy requires the `Package` field annotations to `typeof`-reference *exported* consts (the `nonNegativeInteger` precedent from semver). `internal/format.ts` still holds the pure format functions; only the field codecs moved out to `Package.ts` as public.

## Dependency-map representation

Per [resolved decision 2](#resolved-decisions): `HashMap<string, Dependency>` for the four dependency maps, `HashMap<string, string>` for `scripts`. Empty maps are stripped on encode (a `format` concern, see [services](#services-and-layers)). Structural equality across the maps comes for free, which the round-trip tests rely on.

As-built: the `Record ↔ HashMap` codec is `Record(String, String).pipe(withDecodingDefaultKey(Effect.succeed({})), decodeTo(HashMap, transform))`. The decoding default **must sit on the `Record` side, before `decodeTo`**, and it takes an `Effect` (`Effect.succeed({})`), not a thunk — applying the default *after* the HashMap decode breaks the encode direction. The codecs are `@public` consts in `Package.ts`, **not** `internal/fields.ts` privates — see the [field-codec as-built note](#optional-field-representation).

## The `rest` catch-all, wire transform, and `.extend()` story

The genuinely-good v3 design (review §1) is preserved with a v4 implementation:

- `Package` carries a `rest` field holding unknown top-level keys.
- The **wire transform** (`Package.schema`, replacing v3's `makePackageJsonSchema` + `Schema.typeSchema` trick) partitions raw object keys against `Class.fields`: known keys decode to typed members, the remainder flow into `rest`; on encode, `rest` is flattened back out to top-level keys.
- Because the partition is against `Class.fields`, **`.extend()`ed subclasses automatically pull their new fields out of `rest` into typed members** — the extension differentiator (`docs/05-extending-the-schema.md`).

**Verify-at-port-time (review §3):** v4 may model the open remainder without v3's `Schema.Data(Schema.Record(...))` cast + `disableValidation` construction; confirm whether a plain `Schema.Record` under `decodeTo` suffices for `rest`, and whether the wire partition is cleaner as an `encodeTo`/`decodeTo` pair on the class.

As-built: the wire transform is `RawJson.pipe(Schema.decodeTo(Class, SchemaTransformation.transform({ decode, encode })))`. `decode` partitions raw keys against `Class.fields` into typed members plus `rest`; `encode` flattens `rest` back out to top-level keys (there is no literal `rest` key on disk). `rest` is `optionalKey(Record(String, Unknown))` — a plain `Schema.Record`, no `Schema.Data` cast and no `disableValidation` needed. For `.extend()`ed subclasses the codec is rebuilt via **`Package.wireFor(Subclass)`** (not a single `Package.schema` const), which re-partitions against the subclass's `Class.fields`; the custom-field-out-of-`rest` round-trip is verified.

## Dual-signature statics

`Package`'s mutation statics use `Function.dual` so data-first (`Package.setVersion(pkg, v)`), curried (`Package.setVersion(v)(pkg)`) and pipeable (`pkg.pipe(Package.setVersion(v))`) call styles all work — the single best DX pattern in the repo (review §1). The v3 class implements `Pipeable` manually to make instance `.pipe` work.

**Verify-at-port-time:** whether v4 `Schema.Class` instances are `Pipeable` out of the box (dropping the manual overload block) or still need the manual impl (review §3 table row 1). This is the same `Fn.dual` machinery `@effected/semver` already ships on `Range.max`/`min` — reuse that proven pattern.

As-built: **v4 `Schema.Class` instances are NOT Pipeable** — the manual `pipe` overload block is **retained** (this resolves the open question: it does not drop). The `Function.dual` machinery is reused from `@effected/semver` unchanged.

## Error set (derived from raise sites)

The 10 v3 error classes port to `Schema.TaggedErrorClass` (the [standards ladder](../effect-standards.md#error-handling-standards) default), each keeping its `get message()` getter, **dropping the `*Base` public export** (the API-Extractor need is met by the `@public X_base` house idiom, a different thing — see [API Extractor bases](#api-extractor-bases-house-policy)). Each error is defined in the module of the concept that raises it, not a central `errors/`.

| Error | Owner module | Raised by | Payload |
| --- | --- | --- | --- |
| `PackageDecodeError` | `Package.ts` | `Package.schema` decode | structured `cause: Schema.Defect` (the `SchemaError`), **not** a flattened `message: string` (review §2 fix) |
| `InvalidPackageNameError` | `PackageName.ts` | `PackageName` decode / `Package.setName` | `input`, computed `message` |
| `InvalidSpdxLicenseError` | `License.ts` | `License` decode / `Package.setLicense` | `input`, computed `message` |
| `InvalidDependencySpecifierError` | `DependencySpecifier.ts` | `DependencySpecifier` decode helper | `input` (reason no longer a hardcoded prose restatement of the tag) |
| `PackageValidationError` | `PackageValidator.ts` | `PackageValidator.validate` | aggregated `RuleFailure[]` + multi-line report getter |
| `DependencyResolutionError` | **`@effected/npm`** (imported) | resolver / `Package.resolve` | `specifier`, `cause` |
| `PackageJsonReadError` | `PackageJsonFile.ts` | `read` (fs read failure) | `path`, `cause: Schema.Defect` |
| `PackageJsonNotFoundError` | `PackageJsonFile.ts` | `read` (ENOENT) | `path` — its own tag for `catchTag` routing |
| `PackageJsonParseError` | `PackageJsonFile.ts` | `read` (JSON parse) | `path`, `cause` |
| `PackageJsonWriteError` | `PackageJsonFile.ts` | `write` (fs write) | `path`, `cause` — **narrowed** to the fs-write failure only, not the v3 catch-all absorbing resolution + encode + fs errors |

**Structure-preserving discipline (house rule, review §2):** `PackageDecodeError` and the read/write errors carry the underlying failure as a **`cause` field** (`Schema.Defect`/`DefectWithStack`), never a stringified `message`. The v3 `PackageJsonDecodeError` flattening the entire `ParseError` into a string, and `PackageJsonWriteError.cause: unknown` absorbing three distinct failures, are both fixed. `SchemaError` is normalized to the domain error at the boundary via `Effect.catchTag("SchemaError", …)`, never leaked deep into logic.

**Error-count note:** the read boundary keeps four tags (`Read`/`NotFound`/`Parse`/`Write`) because not-found genuinely deserves its own tag for `catchTag` routing — this is restrained granularity, not proliferation. Total error surface drops from 20 public exports (10 + 10 `*Base`) to ~10 tagged classes (plus their `@public X_base` consts, which are documented not-for-direct-use).

As-built: the read boundary **folds the decode failure into the shared `PackageDecodeError`** (owned by `Package.ts`) rather than introducing a separate `PackageJsonDecodeError` — the read path reuses the same decode error the `Package.schema` boundary raises. So the read boundary is four tags total, cleaner than v3's separate decode error.

## Services and layers

The first real exercise of the [services-and-layers standards](../effect-standards.md#services-and-layers-standards). Seven v3 services collapse to four `Context.Service` classes; the eight `layers/*Live.ts` files disappear into layers exported as consts inside each concept module (memoized by reference — never getters).

- **`PackageJsonFile`** (the only IO service) — **merges v3's `PackageJsonReader` + `PackageJsonWriter`**. `read(path)` → `Effect<Package, PackageJsonReadError | NotFoundError | ParseError, FileSystem>`; `write(path, pkg, options?)` → `Effect<void, PackageJsonWriteError, FileSystem>`. Programs against **core `FileSystem`/`Path`** (v4), so the layer requires no platform peer; consumers provide `@effect/platform-node`'s `NodeFileSystem.layer` at the edge. Uses the `Path` service for parent-dir derivation (no `path.lastIndexOf("/")` string-slicing — Windows-correct). As-built: `write` gained a **mkdir-parent enhancement** over v3 (`Path.dirname` + `fs.makeDirectory(recursive: true)` before writing); both the mkdir and the write fail as the narrowed `PackageJsonWriteError`.
- **`PackageValidator`** — `Context.Service` + layer; `ValidationRule` interface, `defaultRules`, and the genuinely-parameterized `layer({ rules })` factory (standards-permitted parameterization). `validate(pkg)` → `Effect<void, PackageValidationError>`. The `has-repository` rule reads the **modeled** `repository` field, not `pkg.rest`.
- **`CatalogResolver`** / **`WorkspaceResolver`** — **not defined here.** The `Context.Service` contracts and their no-op default layers live in [@effected/npm](npm.md); `Package.resolve` imports the tags and requires them from context. See [resolution belongs to @effected/npm](#resolution-belongs-to-effectednpm).

Two design changes that ARE the pure/IO boundary (review §5, both land):

1. **Resolution moves out of `write`.** The v3 writer silently runs `Package.resolve` on every write — with a real resolver, *writing a file mutates its contents*. `write` writes what it is given; resolution is an explicit `Package.resolve(pkg).pipe(...)` step the caller composes (or an opt-in write option). The v3 `Effect.provideService(CatalogResolver, …)` **inside** the writer (business logic re-providing services locally — a standards violation) is deleted.
2. **`PackageJsonFormatter` + `PackageJsonTransformer` dissolve into pure `internal/format.ts` functions** surfaced as `write` options and `Package.toJsonString(options)`. Both v3 default impls are pure `Record → Record` steps; keeping them as services (one effectful, one sync, same shape — inconsistent) buys nothing without a demonstrated layer-swap need. The canonical `sort-package-json` key order, dependency sorting and empty-map stripping become pure functions.

Every service operation is instrumented (see [observability](#observability-plan)). Layers are provided at boundaries only (app entry, test boundary); business logic requires services and never calls `Effect.provide` locally. A composite convenience layer (`PackageJsonFile.layer` wiring the default resolvers/validator) is exported for the common case.

## Observability plan

v3 has zero instrumentation. Per the [observability standard](../effect-standards.md#observability-standards), `Effect.fn("name")` at public *fallible* operation boundaries: every `PackageJsonFile` op (`PackageJsonFile.read`, `PackageJsonFile.write`), `PackageValidator.validate`, `Package.resolve`, the effectful mutation statics (`Package.setVersion`/`setName`/`setLicense`), and the `Package.schema` decode entry. Pure getters, the specifier taxonomy, and the format functions are **not** instrumented — consistent with the wrapping policy (no `Effect`, no span). The library stays telemetry-agnostic: no OTel configuration anywhere; applications compose `@effect/opentelemetry` at the edge. This is the first port with services, so it is the first to demonstrate the "named span on every fallible service boundary" idiom end-to-end.

## API Extractor bases (house policy)

Per the [ratified house policy](../effect-standards.md#api-extractor--effect-class-factories) and the `effect-api-extractor-bases` skill: every Effect class factory gets a named, exported, `@public`-tagged `X_base` const with an explicit factory-return-type annotation, re-exported from `index.ts`, each carrying a not-for-direct-use doc comment. This port has a **large** base surface — `Schema.Class` for `Package`, `PackageManager`, `Person`, `DevEngine`; `Schema.Class`/brand bases for `PackageName`, `DependencySpecifier`, `License`; `Schema.TaggedClass` (or `Schema.Class` with `kind`) for `Dependency`; `Schema.TaggedErrorClass` for all ~10 errors; `Context.Service` bases for the four services. Any schema helper const referenced by those annotations (field codecs in `internal/fields.ts` that leak into a `@public` signature, literal sets, the `kind` union) is likewise `@public` — silk's binary release-tag policy propagates. Target: a zero-warning `dist/prod/issues.json`. **`Package`'s wire transform and `.extend()` factory are the heavy case** — the transform's return type and the `rest`-partition helper must annotate cleanly; expect to lean on the `Schema.Schema<Self>` form the recursive nodes used in jsonc/yaml if `Package.schema` self-references.

As-built (realignment, 2026-07-08): the `@public X_base` idiom above is superseded by the inline factory form (see [effect-standards.md](../effect-standards.md#api-extractor--effect-class-factories)). Despite the large base surface (`Package`, `PackageManager`, `Person`, `DevEngine`, the brand classes, `Dependency`, all ~10 `TaggedErrorClass` errors, the `Context.Service` bases), every factory is now written inline with **no exported `*_base` const**; the synthesized `_base` heritage symbols are suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern) and land in the `issues.json` `suppressed` bucket, keeping it zero-warning. The reusable field codecs (`DependencyMapField`, `BinField`, `ExportsField`, etc. in `Package.ts`) stay **`@public`** — they are genuine reusable API referenced by the `Package` field annotations, not `_base` scaffolding, so the binary release-tag policy still applies to them; only the `*_base` symbols were removed.

## v4 API drift to verify early

The discipline (semver was burned mid-port by v4 removing `SortedSet`): verify the exposed v4 surface *before* committing. Facts already house-verified during jsonc/yaml and adopted here: no `ParseResult` module (use `Schema.decodeTo`/`SchemaIssue.InvalidValue`); no `Either` root export (`Result` + `Effect.result`); `Schema.optionalKey`/`suspend`/`decodeTo`/`TaggedErrorClass` shapes; `typeof X.Type` for the type. **Remaining to verify at port time**, each resolving to an as-built note:

- **`FileSystem`/`Path` in `effect` core** — the exact v4 import path and service surface `PackageJsonFile` programs against (the boundary-tier crux; jsonc/yaml never touched it). Confirm `NodeFileSystem.layer` from `@effect/platform-node@catalog:effect` provides it.
- **`Function.dual` + instance `Pipeable`** on a v4 `Schema.Class` — whether the manual `Pipeable` overload block drops (reuse `@effected/semver`'s proven `Fn.dual` pattern). As-built: it does **not** drop — v4 `Schema.Class` instances are not Pipeable, so the manual block is retained (see [dual-signature statics](#dual-signature-statics)).
- **Pure sync/Option decode of `Range.FromString`** — the exact v4 combinator (`Schema.decodeUnknownOption`/`decodeOption` or a `Result`-based sync decode) that makes `DependencySpecifier.isRange` pure, killing the `Effect.runSync`-in-getter. If none is ergonomic, coordinate a pure `Range.parseOption`/`Range.is` static addition to `@effected/semver` (a small, clean follow-up — see [semver.md](semver.md)). As-built: `Schema.decodeUnknownExit(Range.FromString)` + `Exit.isSuccess`; no `@effected/semver` follow-up needed (see [DependencySpecifier](#dependencyspecifier)).
- **`HashMap` codec surface** — `Record ↔ HashMap` `decodeTo`/`encodeTo`, and whether `Schema.HashMap` exists or the codec is hand-built. As-built: hand-built as `Record(String, String).pipe(withDecodingDefaultKey(Effect.succeed({})), decodeTo(HashMap, transform))` — the decoding default sits on the `Record` side and takes an `Effect` (see [dependency-map representation](#dependency-map-representation)).
- **Open-remainder modeling for `rest`** — whether v4 drops the `Schema.Data` cast + `disableValidation` (see [wire transform](#the-rest-catch-all-wire-transform-and-extend-story)). As-built: it does — `rest` is a plain `optionalKey(Record(String, Unknown))`, no cast, no `disableValidation`.
- **`spdx-expression-parse` interop** — CJS default-import shape under v4/NodeNext; the `.d.ts` shim's fate.

## Port strategy

Unlike the 12k-line yaml engine, this package has **no hot recursive engine** — it is schemas, a model class, a taxonomy and four services (~2,300 lines). The risk is concentrated in the `Package` wire transform / `.extend()` mechanics and the first-time boundary-service wiring, not raw volume. Sequencing:

1. **Scaffold** the boundary package per [package-setup.md](../package-setup.md) (copy a sibling; set `name`, `repository.directory`, the two model paths; add the `@effected/semver` `workspace:*` and `spdx-expression-parse` deps and the `@effect/platform-node` devDep). `pnpm install`, then **check `git diff pnpm-lock.yaml`** for the optional-binary-pruning footgun.
2. **Port the leaf concepts first** (`PackageName`, `DependencySpecifier`, `License`, `PackageManager`, `Person`, `DevEngines`, `Dependency`) — pure schema classes with statics, each with its errors. Verify each against the installed beta as it lands.
3. **Port `Package`** — the model, getters, dual statics, `copyWith`, the wire transform + `.extend()` factory, `resolve`. This is the design-risk center; get the wire partition and `.extend()` round-trip green before moving on.
4. **Port the services** — `PackageValidator`, the two resolvers, then `PackageJsonFile` (the IO service over core `FileSystem`). Wire the composite layer.
5. **Rewrite the tests** to `@effect/vitest` (see [testing](#testing-strategy)); the round-trip snapshot and reader integration tests are the safety net — regenerate snapshots against v4 output and diff deliberately (v4's encoder may order or format differently than v3).
6. **Build gate:** `pnpm --filter @effected/package-json typecheck`, `turbo build:prod` with a zero-warning `dist/prod/issues.json`, biome clean, tests green.

## Testing strategy

`@effect/vitest` with `it.effect` the default mode — never plain `it()` + `Effect.runPromise`/`runSyncExit` with `Effect.provide(Layer)` repeated per test body (all v3 tests are this anti-pattern; the *cases* port well, the *harness* is rewritten — review §2). Shared wiring via top-level `layer(PackageJsonFile.layer)((it) => {...})`, memoized and scoped to the group; `it.layer(...)` for nested isolation. `__test__/utils/layers.ts`'s hand-duplicated `PackageJsonLive` wiring is deleted in favor of the exported composite layer.

- **Property tests** (`it.effect.prop` + `Schema.toArbitrary`) for the dependency-specifier taxonomy (every protocol classified correctly and round-trips) and name-brand validation. Pattern-field checks use **lookahead-free** regexes so `toArbitrary` derivation works.
- **Round-trip / wire-transform tests**: unknown `rest` fields survive read/edit/write; `.extend()`ed subclasses pull custom fields out of `rest`; empty-map stripping and canonical key order on encode. Snapshots regenerated against v4 and diffed deliberately.
- **Integration tests** (`it.effect`, real `NodeFileSystem.layer` from `@effect/platform-node`): `PackageJsonFile.read`/`write` against the ported fixtures (`minimal`/`full`/`scoped`/`with-custom-fields`/`boilerplate`), incl. the idempotent-write and not-found paths. These are the only tests that provide a platform layer — the boundary discipline made explicit.
- **Error-path tests** via `Exit`/`Cause` inspection: each read error tag reached, `PackageValidationError` aggregation, structured `cause` preserved (not stringified), and the boundary guarantee that `Package.schema` decode failures surface as `PackageDecodeError` (never raw `SchemaError`).
- **Behavior-contract tests**: dual-signature statics in all three call styles, `copyWith` derived-patch completeness, `resolve` with real vs no-op resolvers, and the fixed **`write` does not mutate contents** contract (resolution no longer fused into write).

Tests live in `packages/package-json/__test__/` split per concept (`Package`, `PackageName`, `DependencySpecifier`, `Dependency`, `License`, `PackageManager`, `Person`, `DevEngines`, `PackageValidator`, `PackageJsonFile`), integration under `__test__/integration/`, per repo convention.

As-built: all tests green, zero-warning `dist/prod/issues.json`. The design's round-trip **snapshots were replaced with explicit structural round-trip assertions** — v4-encoded-output snapshots proved brittle, so the same fidelity contract (unknown-field preservation, key order, empty-map stripping, no-mutation-on-write) is asserted structurally instead. Snapshots are regenerable if wanted later. Pattern-field checks use the lookahead-free name regexes (see [PackageName](#packagename)) so `Schema.toArbitrary` derivation works.

## Resolution belongs to @effected/npm

`Package.resolve` turns `catalog:`/`workspace:` specifiers into concrete ranges — but resolution *fundamentally requires* workspace/catalog context that a package.json-document library cannot have (hence the no-op defaults, which resolve nothing). The v3 package put the resolver contracts *inside* package-json; investigation for this design found the presumed second consumer, `@effected/workspaces` (playbook target #8), **already carries its own, differently-shaped resolution domain** — a rich `CatalogSet` value object, its own live `CatalogResolver` service, and the `@pnpm/catalogs.*` dependency footprint (workspaces review §1/§5). It would *not* natively implement package-json's minimal `rangeOf`/`versionOf` tags.

Three options were weighed: (A) keep the contracts + no-op defaults in package-json and mark the seam; (B) drop `Package.resolve` and push resolution wholesale to workspaces; (C) extract the contracts to a shared package now. **(C) was chosen on the maintainer's roadmap knowledge** — there are downstream uses for these contracts beyond package-json queued, which makes the second consumer real rather than speculative and justifies extracting now instead of the project's usual defer-until-second-consumer default.

The contracts therefore live in **[@effected/npm](npm.md)** (pure tier): `CatalogResolver`, `WorkspaceResolver`, their no-op default layers, and `DependencyResolutionError`. package-json's `Package.resolve` imports the tags and requires them from context; a consumer provides a real implementation at the edge. The dependency arrow: `@effected/package-json` → `@effected/npm` (`workspace:*`), and later `@effected/workspaces` → `@effected/npm` when it reconciles its own machinery against these contracts (an expand/refactor of `@effected/npm`, deferred to that migration). `@effected/package-json` is also a consumer of `@effected/semver` (`workspace:*`, `SemVer`/`Range`/`InvalidVersionError`).

## Deliberately not ported

- **The `./schema` second entry point** — one entry; field codecs become statics or `internal/` privates.
- **The four copy-pasted dependency classes** — one `Dependency` with a `kind` field; getters written once.
- **The two sources of truth for specifier classification** — merged into `DependencySpecifier`.
- **All 10 `*Base` error exports** — v3's doubled public error surface stays banned; the API-Extractor need is met by the inline factory + narrow `_base` suppression (see the [API Extractor bases](#api-extractor-bases-house-policy) as-built note): no `*_base` symbol is exported at all.
- **The `PackageJson*` service prefixes and `*Schema` suffixes** — the package name and "class IS the schema" remove the disambiguation need; the `SpdxLicense as SpdxLicenseSchema` / `PackageNameType` alias gymnastics die.
- **`PackageJsonFormatter` + `PackageJsonTransformer` services** — pure `internal/format.ts` functions surfaced as options.
- **The `CatalogResolver` / `WorkspaceResolver` contracts** — extracted to [@effected/npm](npm.md); package-json imports the tags rather than defining them (decision 4, [resolution belongs to @effected/npm](#resolution-belongs-to-effectednpm)).
- **`Effect.runSync` inside getters** — pure `Range.FromString` decode instead.
- **Resolution fused into `write`** — explicit `Package.resolve` step; `write` writes what it is given.
- **The `PackageNameUtil` floating object and all floating specifier functions** — statics on their concept classes.
- **The `Schema.optionalWith({ as: "Option" })` Option-everywhere model** — `Schema.optionalKey` default (decision 1).
- **Plain-vitest + per-test `Effect.provide`** — `@effect/vitest` `it.effect` + top-level `layer(...)` groups.
- **The v3 `@effect/platform` peer** — FileSystem is core in v4; peers are `effect` only.
