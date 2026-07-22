---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-07-22
last-synced: 2026-07-22
completeness: 92
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../formatter-convention.md
  - semver.md
  - jsonc.md
  - yaml.md
  - npm.md
  - spdx.md
---

# @effected/package-json design

## Overview

`@effected/package-json` is package.json parsing, editing, validation and file IO as Effect schemas — a **boundary-tier** manifest library and the kit's reference for the pure/IO boundary discipline. The `Package` rich `Schema.Class` is the domain model with computed getters, immutable-mutation statics, a round-trip-fidelity `rest` catch-all and semantic field decoding (`version`→`SemVer`, `packageManager`, `person`, SPDX `license`, branded names). All IO is confined to a single module, `PackageJsonFile`, over core `FileSystem` / `Path`.

## Tier and dependencies

**Boundary tier — one package, IO confined to a single module.** In v4 the fs split motivation evaporates because `FileSystem`/`Path` live in `effect` core: a pure core and a hypothetical fs package would have the identical peer closure (`effect`), so splitting would only isolate ~115 lines of IO behind paired versioning for no gain. `sideEffects: false` lets bundlers tree-shake the fs code out of pure usage.

The tier is **boundary**, set by the file IO in `PackageJsonFile.ts` and nothing more: the package carries no runtime dependency outside `effect` core. It was integrated until `spdx-expression-parse` — its one foreign runtime dependency — was removed by delegating SPDX-expression validity to [`@effected/spdx`](spdx.md), a pure `@effected` package reached via `workspace:~`. A `workspace:~` edge to a pure package does not re-lift the tier ([R2 propagates only tier-3](../effect-standards.md#dependency-policy)), exactly as the existing `@effected/semver` and `@effected/npm` edges do not.

- `peerDependencies`: `effect` only (`catalog:effect`) — no `@effect/platform` peer, since FileSystem is core.
- `dependencies`: `@effected/semver` (`workspace:~` — `SemVer` instances appear in `Package`'s API, but consumers read the decoded value far more than they construct their own, so a regular dependency rather than a peer); `@effected/npm` (`workspace:~` — the resolver contracts and shared specifier/integrity vocabulary); `@effected/spdx` (`workspace:~` — SPDX-expression validity for the `license` field).
- `devDependencies`: `@effect/platform-node` (`catalog:effect`) for integration tests that provide a real `FileSystem`; the usual `@effect/vitest`, `@types/node`, `typescript`.

Peer closure holds: `effect` has no peers, and `@effected/semver` / `@effected/npm` / `@effected/spdx` each declare only `effect`. `@effect/platform-node` stays devDependencies-only; consumers of the file API provide their own platform implementation at the edge.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept). Each concept file owns its `Schema.Class` model(s), the errors that concept raises and — if it is a service — the `Context.Service` class plus its layer(s). See `src/`:

- `Package.ts` — the core model, computed getters, dual mutation statics, `copyWith`, `resolve`, the wire transform and `.extend()` story, `PackageDecodeError`, and the reusable `@public` field codecs (`BinField`, `DependencyMapField`, `ExportsField`, `PublishConfigField`, `RepositoryField`, `StringMapField`, `PeerDependenciesMetaField`).
- `PackageName.ts`, `License.ts`, `PackageManager.ts`, `Person.ts`, `DevEngines.ts`, `Dependency.ts` — the leaf concepts, each with its statics and errors.
- `PackageValidator.ts` — the `Context.Service`, `ValidationRule` interface, `defaultRules` and the parameterized `layer({ rules })` factory.
- `PackageJsonFile.ts` — **the only IO module**: one `Context.Service`, `read` + `write` over core `FileSystem`, and its read/write error tags.
- `PackageJsonFormat.ts` — the **decode-free** formatting seam: `sortValue` (value→value) and `formatToString` (bytes→bytes), plus `PackageJsonSyntaxError` and `PackageFormatTextOptions`. See [the formatting seam](#the-decode-free-formatting-seam).
- `internal/format.ts` — the pure canonical-key-order, map-alphabetizing and empty-map-stripping functions, shared by the write options, `Package.toJsonString` and `PackageJsonFormat`. Holds `KEY_ORDER` and its `sort-package-json@4.0.0` provenance comment — see [formatting](#formatting-byte-agreement-with-the-ecosystem-oracle).

`DependencySpecifier` is **not** defined here — the specifier taxonomy lives in [`@effected/npm`](npm.md) and `index.ts` re-exports it for surface compatibility. The package ships a single entry point (`src/index.ts`); there is no `./schema` subpath, and field codecs are either `@public` consts on their owning concept or `internal/` privates.

## Effect-wrapping policy

The [jsonc/yaml wrapping policy](jsonc.md#effect-wrapping-policy) applies, adapted for a service-bearing boundary library: **pure synchronous where nothing can fail; `Effect` where the error channel is real (including all service IO); no `Effect.runSync` inside getters, ever.**

- **Pure synchronous**: computed getters (`isPrivate`, `isScoped`, `isESM`, `hasDependency`), the specifier taxonomy statics, `PackageName` predicates, the format functions and `Package.toJsonString(options)`. Absence is `Option` (from `HashMap.get`) or a plain optional field, never a wrapping `Effect`.
- **`Effect`**: the effectful mutation statics that validate (`setVersion`, `setName`, `setLicense`), `Package.resolve`, decode-from-unknown, and every `PackageJsonFile`/`PackageValidator` operation.

Range detection inside the specifier taxonomy decodes `@effected/semver`'s `Range.FromString` **purely** via `Schema.decodeUnknownExit(Range.FromString)` + `Exit.isSuccess`, so no effect runs inside a getter.

## Public API

Class-based DX throughout, per the semver north star; the class IS the schema, so there are no `*Schema` suffixes or type-alias re-exports. See `src/` for exact signatures.

### Package

The rich `Schema.Class` — the single best DX pattern in the repo:

- **Computed getters** (pure): `isPrivate`, `isScoped`, `isESM`, `hasDependency(name)`, the dependency-map accessors.
- **Immutable mutation statics** with the [dual-signature idiom](#dual-signature-statics): `setVersion`, `setName`, `setLicense`, `addDependency`, `removeDependency`, `setScript` and the rest. Effectful ones fail typed.
- **`copyWith`** takes a patch type derived from the fields (`Partial` over all model fields), not a hand-maintained partial that silently omits half.
- **`resolve`** — the static-with-R that turns `catalog:`/`workspace:` specifiers into concrete ranges using `CatalogResolver | WorkspaceResolver` from context. It is the one place the pure model reaches into DI (the standard "static method with R" pattern), and resolution is **not** fused into `write`.
- **`rest`** catch-all preserving unknown top-level fields across a read/edit/write cycle (see [the wire transform](#the-rest-catch-all-and-extend-story)).
- **`toJsonString(options?)`** — the pure serialization path, first-class rather than only reachable through the writer.

Modeled fields include `name` (`PackageName`), `version` (`SemVer`), `license` (`SpdxLicense`), `packageManager` (`PackageManager`), `author`/`contributors` (`Person`), `repository`, the dependency/format field codecs and `rest`. `publishConfig` is modeled as an **open `Schema.Record`** and `repository` as a `Union([String, Record])` rather than typed open structs — a typed open struct runs in v4 but does not annotate cleanly for a zero-warning `issues.json`. Round-trip fidelity is fully preserved; the only cost is that typed `publishConfig.access` field access is dropped (consumers read it off the open record).

### Leaf concepts

- **`PackageName`** — `PackageName` / `ScopedPackageName` / `UnscopedPackageName` brands (a `.check(...)` + `Schema.brand` over the npm name grammar, written with **lookahead-free regexes** so `Schema.toArbitrary` property tests derive) plus statics `isValid` / `scope` / `unscoped` / `isScoped`, attached via `Object.assign` since a `const` and a `namespace` cannot merge in TS. The branded types export explicitly as `string & Brand.Brand<"…">`.
- **`SpdxLicense`** (`License.ts`) — a brand validating the `license` field, delegating core SPDX-expression validity to [`@effected/spdx`](spdx.md)'s `isValidExpression` and keeping only the npm-specific `UNLICENSED` and `SEE LICENSE IN <file>` cases, which are npm semantics rather than SPDX grammar.
- **`PackageManager`** — a class parsing `"pnpm@10.x+sha512.abc"` into `name` / `version` / `integrity`, where `integrity` is a genuine `Schema.Option` field (absence is computed on) typed as [`@effected/npm`'s `IntegrityHash`](npm.md#integrityhash) brand. Because the brand rejects a malformed integrity segment, `PackageManager.FromString` now **fails typed** on malformed integrity rather than round-tripping it as a raw string — real corepack values are unaffected.
- **`Person`** — a class parsing `"Name <email> (url)"` into structured fields and encoding back, wired into `Package.author`/`contributors`. It carries a `rest` catch-all of its own, on the same wire-transform pattern as `Package`: an object-form author with a `twitter` or `github` key would otherwise lose it on a read→write cycle, which is exactly the silent deletion the [fidelity obligation](../formatter-convention.md#decision-5--the-fidelity-obligation) forbids and which a schema-derived arbitrary is structurally incapable of generating. `Package` and `Person` are the package's **only** object-shaped models and therefore the only two that need a catch-all; every other leaf is a scalar or a closed shape.
- **`DevEngine`** — the `DevEngine` class and `devEngines` field schema.
- **`Dependency`** — **one** class with a `kind` field (`@effected/npm`'s `DependencyKind`) rather than four near-identical tagged classes; the protocol getters are written once, delegating to `DependencySpecifier`. `UnresolvedDependency` is a type + guard.

## The `rest` catch-all and `.extend()` story

`Package` carries a `rest` field holding unknown top-level keys. The **wire transform** (`Package.schema`) partitions raw object keys against `Class.fields`: known keys decode to typed members, the remainder flow into `rest`; on encode, `rest` is flattened back out to top-level keys (there is no literal `rest` key on disk). Because the partition is against `Class.fields`, `.extend()`ed subclasses automatically pull their new fields out of `rest` into typed members — the codec is rebuilt via `Package.wireFor(Subclass)`, which re-partitions against the subclass's fields.

The transform is `RawJson.pipe(Schema.decodeTo(Class, SchemaTransformation.transform({ decode, encode })))`; `rest` is a plain `optionalKey(Record(String, Unknown))` — no `Schema.Data` cast, no `disableValidation`.

## Optional-field and dependency-map representation

Omissible object fields decode via `Schema.optionalKey` (the [schema standard](../effect-standards.md#schema-standards) default), with implementation-level `?? default`. `Schema.Option`-typed decoded fields survive only where a field's presence/absence is actively branched on in the model's logic — `PackageManager.integrity` is the clear case.

The four dependency maps are `HashMap<string, Dependency>` and `scripts` is `HashMap<string, string>` — immutable, Effect-idiomatic, structural equality for free; consumers use `HashMap.get(pkg.dependencies, "effect"): Option<Dependency>`. The `Record ↔ HashMap` codec sits its decoding default on the `Record` side, before `decodeTo`, taking an `Effect` (`Effect.succeed({})`) — applying the default after the HashMap decode breaks the encode direction. Empty maps are stripped on encode.

## Dual-signature statics

`Package`'s mutation statics use `Function.dual` so data-first (`Package.setVersion(pkg, v)`), curried (`Package.setVersion(v)(pkg)`) and pipeable (`pkg.pipe(Package.setVersion(v))`) call styles all work — reusing the proven `Fn.dual` machinery from `@effected/semver`. v4 `Schema.Class` instances are **not** `Pipeable` out of the box, so the class retains a manual `pipe` overload block.

## Error set

Each error is a `Schema.TaggedErrorClass` defined in the module of the concept that raises it, keeping its `get message()` getter. See the source; the load-bearing ones:

| Error | Owner | Raised by | Payload |
| --- | --- | --- | --- |
| `PackageDecodeError` | `Package.ts` | `Package.schema` decode and the read path | structured `cause: Schema.Defect` (the `SchemaError`), not a flattened string |
| `InvalidPackageNameError` | `PackageName.ts` | name decode / `setName` | `input`, computed `message` |
| `InvalidSpdxLicenseError` | `License.ts` | license decode / `setLicense` | `input`, computed `message` |
| `PackageValidationError` | `PackageValidator.ts` | `validate` | aggregated `RuleFailure[]` + report getter |
| `DependencyResolutionError` | `@effected/npm` (imported) | resolver / `resolve` | `specifier`, `cause` |
| `PackageJsonReadError` / `PackageJsonNotFoundError` / `PackageJsonParseError` / `PackageJsonWriteError` | `PackageJsonFile.ts` | `read` / `write` | `path`, structured `cause` |

**Structure-preserving discipline:** decode and read/write errors carry the underlying failure as a `cause` field (`Schema.Defect`), never a stringified `message`. `SchemaError` is normalized to the domain error at the boundary via `Effect.catchTag("SchemaError", …)`, never leaked deep into logic. Not-found keeps its own tag for `catchTag` routing; `PackageJsonWriteError` is narrowed to the fs-write failure only, and the read path folds decode failures into the shared `PackageDecodeError` rather than minting a separate one.

## Services and layers

The kit's first real exercise of the [services-and-layers standards](../effect-standards.md#services-and-layers-standards). Layers are exported as consts inside each concept module, memoized by reference (never getters), provided at boundaries only (app entry, test boundary) — business logic requires services and never calls `Effect.provide` locally.

- **`PackageJsonFile`** (the only IO service) — `read(path)` and `write(path, pkg, options?)` over **core `FileSystem`/`Path`**, so the layer requires no platform peer; consumers provide `@effect/platform-node`'s `NodeFileSystem.layer` at the edge. `write` derives the parent dir via `Path.dirname` and `makeDirectory(recursive: true)` before writing (both fail as the narrowed `PackageJsonWriteError`).
- **`PackageValidator`** — the `ValidationRule` interface, `defaultRules` and a genuinely-parameterized `layer({ rules })` factory. The `has-repository` rule reads the modeled `repository` field, not `pkg.rest`.
- **`CatalogResolver` / `WorkspaceResolver`** — **not defined here**; `Package.resolve` imports the tags from [`@effected/npm`](npm.md) and requires them from context.

Two boundary properties are load-bearing:

1. **Resolution is out of `write`.** `write` writes what it is given; resolution is an explicit `Package.resolve(pkg).pipe(...)` step the caller composes. A writer that silently runs `resolve` would make *writing a file mutate its contents*.
2. **The formatter and transformer are pure functions**, not services — `internal/format.ts`, surfaced as `write` options and `Package.toJsonString(options)`.

A composite convenience layer wires the defaults for the common case.

## Formatting: byte-agreement with the ecosystem oracle

The formatter's job is not "a reasonable order" — it is **the order the ecosystem already produces**, so running the kit's writer over a repo does not churn every manifest against whatever the team's `sort-package-json` pre-commit hook does next.

**The canonical top-level key order is `sort-package-json@4.0.0`'s default `sortOrder`, re-baselined verbatim** — all 108 keys, with the version recorded as provenance in `src/internal/format.ts` beside the list. Verbatim is the point: a hand-curated *near*-copy is the shape that drifts silently, since every disagreement shows up as a diff in someone's repo rather than as a failure here. Unknown keys append after the known ones — public keys alphabetically, then `_`-prefixed keys alphabetically — matching the oracle's own unknown-key behavior.

### Map-field alphabetization follows from HashMap, not taste

Sorting alphabetizes the dependency maps for canonical presentation, and **`scripts`, `engines` and `bin` join them** — but for a different and stronger reason: the `Package` model carries all three as `HashMap`s, whose encode order is *hash* order. **Source order is already unrecoverable**, so the choice is not "preserve or sort" but "hash order or alphabetical," and deterministic alphabetical wins uncontested. `sort-package-json` sorts `engines` and `bin` identically; its `scripts` sort is a grouped sort agreeing with plain code-unit order except for `pre*`/`post*` pairing. `scripts` also joined `stripEmpty`.

### `PackageIndent` and `"preserve"`

`PackageFormatOptions.indent` is now `PackageIndent` = `number | "tab" | "preserve"`. `"preserve"` reuses the indentation of the source text, backed by an explicit `sourceText` option — and `PackageJsonFile.write` supplies it by **reading the file it is about to overwrite** when the caller gives none. That read is the only way `"preserve"` can mean anything at a write site that holds a decoded `Package` and nothing else; without it the option would silently degrade to a default and quietly re-indent the file.

### The decode-free formatting seam

`PackageJsonFormat` exists because the strict path **hard-fails on legal input**: `Package.decode` raises `PackageDecodeError` on `{"private": true}` and on version-less roots, both perfectly valid manifests. That made the kit unusable as a lint handler and the dogfood consumer routed around it to `sort-package-json`. This package is the only one of the kit's four formatters with a *schema* between text and text, so it is the only one where that could happen at all — the three format packages satisfy the constraint by construction.

Four properties are load-bearing, and they are [the kit formatter convention](../formatter-convention.md#the-rules) rather than local choices:

- **A distinct named entry point, never a `{ strict: false }` flag.** A flag would make the strict path's return type a union of guarantees and hide the choice from both the call site and `grep`.
- **Two shapes because two hosts exist** — value→value and bytes→bytes — routed through one internal sort so they cannot drift.
- **The value path only reorders; it never adds or removes a key.** This is what makes `sortValue`'s `T → T` honest, and it is type-enforced: an earlier `stripEmpty` on the value path was rejected by `tsc`, because removing a key makes `T → T` a lie. The option moved to the text path, defaulted **off**. Capabilities that delete are opt-in, always.
- **Input it cannot handle comes back unchanged**, never partially rewritten.

`formatToString` returns `Result`, not `Effect` — lint hosts are synchronous, and an `Effect` return would force every one of them to build a runtime to format a file. Effect hosts lift with `Effect.fromResult` in one call, so the `Result` serves both. Its options type is deliberately separate from `PackageFormatOptions` (`sourceText` is meaningless when the text *is* the source) and its defaults deliberately diverge from the strict path's; where a default differs, the divergence and its reason are documented on the member, because that is exactly where a silent edit hides.

### Byte-parity fixtures

`__test__/fixtures/` holds real manifests from this repo paired with frozen `sort-package-json@4.0.0` output for the same input, and `Format.test.ts` asserts `Package.decode(input).toJsonString()` byte-equals it. **`sort-package-json` is deliberately not a dependency** — the oracle's *output* is committed, not the tool, so the parity claim is checked without taking a runtime edge on the thing being matched.

The **re-baseline rule** is that the fixtures, the recorded version in the fixture README and the `KEY_ORDER` provenance comment move **together**, in one deliberate act. Regenerating fixtures alone would silently ratify whatever a newer version changed — turning the oracle test from a check into a rubber stamp.

## Resolution belongs to @effected/npm

`Package.resolve` turns `catalog:`/`workspace:` specifiers into concrete ranges, but resolution fundamentally requires workspace/catalog context a package.json-document library cannot have (hence the no-op defaults, which resolve nothing). The resolver contracts live in [`@effected/npm`](npm.md) rather than here for two reasons: `@effected/workspaces` carries its own, differently-shaped resolution domain (a rich `CatalogSet`, its own live `CatalogResolver` and the `@pnpm/catalogs` footprint) and would not natively implement package-json's minimal `rangeOf`/`versionOf` tags; and there are downstream uses for these contracts beyond package-json, making the second consumer real rather than speculative. `@effected/workspaces` implements the contracts as layers over its own services.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards), `Effect.fn("name")` at public *fallible* boundaries: every `PackageJsonFile` op, `PackageValidator.validate`, `Package.resolve`, the effectful mutation statics and the `Package.schema` decode entry. Pure getters, the specifier taxonomy and the format functions are not instrumented. The library stays telemetry-agnostic — applications compose `@effect/opentelemetry` at the edge.

## API Extractor bases

Per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), every Effect class factory is written **inline** with no exported `*_base` const; the synthesized `_base` heritage symbols are suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern), keeping `dist/prod/issues.json` zero-warning. The reusable field codecs (`DependencyMapField`, `BinField`, `ExportsField` and the rest in `Package.ts`) stay `@public` — they are genuine reusable API referenced by the `Package` field annotations, so the binary release-tag policy applies to them.

## Testing

`@effect/vitest` with `it.effect` the default mode; shared wiring via top-level `layer(PackageJsonFile.layer)(...)` groups, scoped and memoized. Tests in `__test__/` split per concept, integration under `__test__/integration/`.

- **Property tests** (`it.effect.prop` + `Schema.toArbitrary`) for the specifier taxonomy and name-brand validation; pattern-field checks use lookahead-free regexes so derivation works.
- **Round-trip / wire-transform tests** assert the fidelity contract structurally (unknown `rest` fields survive read/edit/write; `.extend()`ed subclasses pull custom fields out of `rest`; empty-map stripping and canonical key order on encode) rather than via brittle v4-output snapshots.
- **Integration tests** with a real `NodeFileSystem.layer` are the only tests that provide a platform layer — the boundary discipline made explicit — covering `read`/`write` against the fixtures plus idempotent-write and not-found paths.
- **Error-path and behavior-contract tests** cover each read error tag, `PackageValidationError` aggregation, structured `cause` preservation, the decode-failure-surfaces-as-`PackageDecodeError` guarantee, the dual-signature call styles, `copyWith` completeness, `resolve` with real vs no-op resolvers, and the `write` does not mutate contents contract.
