# Review: package-json-effect → @effected/package-json

Source: `/Users/spencer/workspaces/spencerbeggs/package-json-effect` (v0.3.0, Effect v3)
Target: `@effected/package-json` in the effected monorepo, Effect v4-first, judged against
[effect-standards.md](../design/effected/effect-standards.md).

Repo shape today: ~2,300 lines of `src/`, kind-based folders (`domain/`, `schemas/`,
`errors/`, `services/`, `layers/`), two entry points (`.` and `./schema`), 10 error
classes, 7 services, 8 layers, thorough docs (8 pages) and a large vitest suite with
fixtures and round-trip snapshots.

---

## 1. What is done well

These are the abstractions worth carrying forward, most of them already in the spirit of
the standards doc.

### Package as a rich Schema.Class (the DX core)

`src/domain/Package.ts` is exactly the class-based DX the standards call for: the schema
IS the domain class, with computed getters (`isPrivate`, `isScoped`, `isESM`,
`hasDependency`) and immutable mutation statics. Notably:

- **Dual-signature statics** (`Package.setVersion`, `addDependency`, `setScript`, ...)
  built with `Function.dual`, so all three call styles work: data-first
  `Package.setVersion(pkg, v)`, curried `Package.setVersion(v)(pkg)`, and pipeable
  `pkg.pipe(Package.setVersion(v))`. The class even implements `Pipeable` manually to
  make instance piping work. This is the single best DX pattern in the repo — preserve it.
- **Effectful mutations fail typed**: `setVersion` fails with `InvalidVersionError` (from
  semver-effect), `setName` with `InvalidPackageNameError`, `setLicense` with
  `InvalidSpdxLicenseError`. Errors in the E channel where they belong.

### Round-trip fidelity via the `rest` catch-all + wire transform

The `rest` field on `Package` plus `makePackageJsonSchema` (`src/schemas/package-json.ts`)
is a genuinely good design: unknown top-level fields survive a read/edit/write cycle, and
the wire transform partitions raw keys against `Class.fields` so **`.extend()`ed
subclasses automatically pull their new fields out of `rest` and into typed members**.
The extension story (`docs/05-extending-the-schema.md`) is a real differentiator —
consumers can model `targets`, `silk`, or any custom field with types and keep round-trip
fidelity for everything else. Preserve the concept even if the v4 implementation changes.

### Semantic decoding, not stringly-typed passthrough

- `version` decodes to a `SemVer` instance (semver-effect), encodes back to string.
- `packageManager` parses `"pnpm@10.x+sha512.abc"` into a structured class with
  `name`/`version`/`integrity: Option`.
- `person` fields parse the `"Name <email> (url)"` shorthand into a structured `Person`
  and encode back.
- `license` validates real SPDX expressions (via `spdx-expression-parse`), including the
  `UNLICENSED` and `SEE LICENSE IN` special cases.
- Branded names: `ScopedPackageName` / `UnscopedPackageName` / `PackageName` union with a
  correct hand-rolled npm-name validator.

### The dependency-specifier protocol taxonomy

`protocolOf` and friends classify any specifier into
`range | tag | git | url | npm | file | link | portal | catalog | workspace | unknown`,
including pnpm-specific protocols (`catalog:`, `workspace:`, `portal:`) and GitHub
shorthand. This is accumulated domain knowledge that is hard to get right and directly
useful to the rest of the effected ecosystem (workspaces, pnpm plugin, silk tooling).

### Swappable seams with honest no-op defaults

`CatalogResolver` and `WorkspaceResolver` are interfaces with no-op default layers,
explicitly designed for workspaces-effect to plug in real implementations. The
`ValidationRule` interface + `makePackageJsonValidatorLive({ rules })` factory is a clean
open/closed extension point (a *genuinely parameterized* layer factory, which the
standards permit). `PackageJsonFormatterLive` encodes the `sort-package-json` canonical
key order — small, correct, valuable.

### Error ergonomics

Every error carries structured fields (`input`, `source`, `reason`, `cause`) plus a
computed `get message()` that renders a human-readable string.
`PackageJsonValidationError` aggregates all rule failures into one error with a
multi-line report. This message-as-getter pattern should survive the port.

### Docs and tests

Eight-part docs directory mirroring the public API, integration tests with real fixtures
and round-trip snapshots, and error-path tests using `Exit`/`Cause` inspection. The test
*content* is good; only the *mechanics* need updating (see below).

---

## 2. What is confusing or awkward

Judged as design, not as v3-vs-v4 idiom.

### Kind-based folder sprawl and naming noise

The `domain/ schemas/ errors/ services/ layers/` split is exactly what the standards'
module-per-concept layout supersedes. Symptoms visible in this repo:

- A single logical concept is smeared across four files: e.g. "reading a package.json"
  lives in `services/PackageJsonReader.ts` + `layers/PackageJsonReaderLive.ts` + four
  files in `errors/` + `schemas/package-json.ts`.
- The `PackageJson` prefix on five services (`PackageJsonReader`, `PackageJsonWriter`,
  `PackageJsonFormatter`, `PackageJsonTransformer`, `PackageJsonValidator`) exists only
  to disambiguate inside a flat namespace the package name already provides.
- `Schema` suffixes everywhere (`VersionSchema`, `BinSchema`, `EnginesSchema`,
  `DependencyMapSchema`, `PackageManagerSchema` *alongside* a `PackageManager` class),
  plus import-alias gymnastics (`SpdxLicense as SpdxLicenseSchema` in `Package.ts`) and
  type re-export aliases (`PackageNameType`, `SpdxLicenseType`, `DependencySpecifierType`
  in `schema.ts`) to dodge type/value name collisions. In v4 the class IS the schema, so
  almost all of this evaporates.
- `PackageNameUtil` is a floating util object (`scope`, `unscoped`, `isScoped`) that
  should be statics on the `PackageName` concept.

### The `*Base` error-export ceremony

All 10 errors export both `FooError` and `FooErrorBase` — 20 public exports for 10
concepts — purely to appease declaration bundling of the `Data.TaggedError` mixin
pattern. It doubles the error surface and every consumer has to learn to ignore half of
it. The v4 `Schema.TaggedErrorClass` port should make the Base exports disappear (and if
the declaration bundler still needs them, they belong in `src/internal/`, not the public
API).

### Four copy-pasted dependency classes (~230 duplicated lines)

`Dependency`, `DevDependency`, `PeerDependency`, `OptionalDependency` are near-identical
`Schema.TaggedClass`es, each re-implementing the same 11 protocol getters by hand;
`PeerDependency` adds one field (`isOptional`). The `DependencyProtocolGetters` interface
exists precisely because the implementation couldn't be shared. Redesign: **one
`Dependency` class with a `kind: "prod" | "dev" | "peer" | "optional"` field** (plus
`peerMeta`/`isOptional` as an optional field), and the getters written once. The `_tag`
split buys nothing — nobody pattern-matches these four tags; `Package.getDependencies()`
et al. already tell you which map an entry came from.

### Two sources of truth for specifier classification

`domain/Dependency.ts` (`protocolOf`, `isGitSpecifier`, `isLocalSpecifier`, ...) and
`schemas/dependency-specifier.ts` (`isValidDependencySpecifier`) each contain their own
prefix lists and GitHub-shorthand regexes. They can drift (and their tag/semver regex
heuristics already differ subtly). These are one concept — a `DependencySpecifier` module
owning the brand, the taxonomy, and the predicates as statics.

### Floating functions

`isGitSpecifier`, `isLocalSpecifier`, `isRangeSpecifier`, `isTagSpecifier`,
`parseRangeOption`, `protocolOf`, `isUnresolvedDependency`, `decodeSpecifier`,
`isValidPackageName`, `isValidDependencySpecifier` are all top-level exports. Standards:
these become statics on their concept class (`DependencySpecifier.protocolOf(...)`,
`PackageName.isValid(...)`).

### `Effect.runSync` buried inside instance getters

`parseRangeOption` is `Effect.runSync(Effect.option(parseRange(s)))`, called from the
`range`/`isRange` getters of every dependency class. A pure parse is wrapped into an
Effect by semver-effect and then force-unwrapped synchronously on every getter access.
This is a seam to fix during the @effected/semver redesign: expose a pure
`Range.parseOption(s): Option<Range>` so this package never runs effects inside getters.

### Transformer vs Formatter: two services, one job

`PackageJsonTransformer` ("transform the encoded object before formatting", effectful)
and `PackageJsonFormatter` ("format/sort the raw object", sync) are both
`Record<string, unknown> => Record<string, unknown>` steps in the write pipeline. The
distinction (and the ordering contract between them) is documented only in prose, and one
returns `Effect` while the other doesn't — inconsistent interfaces for the same shape of
operation. Both default implementations are pure functions. Candidate collapse: pure,
exported `format`/`normalize` functions (or statics on the wire concept), with the write
pipeline taking options — keep a service seam only if layer-swapping is a demonstrated
need.

### The writer silently rewrites your dependencies

`PackageJsonWriterLive.write` runs `Package.resolve` (catalog:/workspace: → concrete
ranges) on every write. With the default no-op resolvers it does nothing, but the moment
a real resolver is provided, **writing a file mutates its contents** — publish-prep
behavior fused into a generic "write" operation. `write` should write what it is given;
resolution belongs as an explicit step (`Package.resolve(pkg).pipe(...)` before writing)
or an opt-in option. Related standards violation: the writer calls
`Effect.provideService(CatalogResolver, ...)` *inside* the service implementation to
re-provide services it already yielded — business logic providing locally.

### `Package.resolve` blurs the model/service line

A static on the domain class that requires `WorkspaceResolver | CatalogResolver` from
context. Defensible (it is the standard "static method with R" pattern), but it is *the*
place where the pure model reaches into DI, and it drives the split question in §5.

### Error granularity at the read boundary

Four errors for one operation (`PackageJsonReadError`, `PackageJsonNotFoundError`,
`PackageJsonParseError`, `PackageJsonDecodeError`) is reasonable for `catchTag` routing —
not-found genuinely deserves its own tag. But:

- `PackageJsonDecodeError` flattens the entire `ParseError` into a `message: string`,
  discarding the structured issue tree consumers would want for diagnostics. In v4, wrap
  the `SchemaError` as a `cause` field instead of stringifying it.
- `PackageJsonWriteError.cause` is `unknown` and absorbs three very different failures
  (resolution error, encode error, fs error) into one undifferentiated bucket.
- `InvalidDependencySpecifierError` exists solely for the opt-in `decodeSpecifier`
  helper; `reason` is always the same hardcoded string. The reason fields in several
  errors are prose restating the tag.

### Two overlapping entry points

`.` (index.ts) and `./schema` (schema.ts) both export the domain classes, the domain
errors, and the resolver services; only field-level schemas and `makePackageJsonSchema`
are `/schema`-exclusive. The "advanced" boundary is not a real boundary — a consumer
cannot predict which import a given name comes from. One entry point (or a genuinely
disjoint split) is better.

### Modeled-field gaps and dead exports

- `Person`/`PersonSchema` are fully implemented and tested but **not used by `Package`**
  — `author`/`contributors` fall into `rest`. Either wire them in or drop them.
- `repository` is unmodeled, which forces the `has-repository` validation rule to poke
  into `pkg.rest` with `Object.hasOwn` (the comment in `PackageJsonValidatorLive.ts`
  acknowledges the awkwardness).
- `Package.copyWith` accepts a hand-maintained `Partial<{ 9 fields }>` that silently
  omits the other 9 model fields — drift-prone; a ported version should derive the patch
  type from the fields.

### Test mechanics vs standards

All tests are plain vitest `it()` + `Effect.runPromise`/`runSyncExit`, with
`Effect.provide(Layer)` repeated inside each test body, and `__test__/utils/layers.ts`
hand-duplicates the `PackageJsonLive` wiring. Standards require `@effect/vitest`
`it.effect` + top-level `layer(...)` grouping. The test *cases* port over well; the
harness must be rewritten.

---

## 3. v4 migration implications (this codebase specifically)

| v3 construct (here) | Where | v4 target |
| --- | --- | --- |
| `Schema.Class<Package>("Package")({...})` + manual `Pipeable` impl | `Package.ts`, `Person`, `PackageManager`, `DevEngine` | `Schema.Class` (v4); verify whether instance `.pipe` still needs the manual overload block or can be dropped |
| `Schema.TaggedClass` x4 dependency variants | `domain/*Dependency.ts` | Single `Schema.Class` (or `TaggedClass`) `Dependency` with `kind` field |
| `Data.TaggedError("X")` + exported `XBase` mixin | all 10 `src/errors/*` | `Schema.TaggedErrorClass` per the standards ladder; drop `*Base` from the public API; keep `get message()` getters |
| `Context.Tag("pkg/X")<X, {...}>()` x7 | `src/services/*` | `Context.Service` classes, identifier + shape in one place, layers co-located in the same concept file |
| Separate `layers/*Live.ts` files | `src/layers/*` | Layers exported as statics/consts inside each concept module (`PackageJsonFile.layer`, etc.) |
| `Schema.optionalWith(X, { as: "Option" })` (pervasive — 15+ fields) | `Package.ts`, field schemas | Biggest mechanical delta. v4: `Schema.optionalKey` for omissible fields; decide per field whether the decoded type stays `Option` (via a decodeTo-to-Option transformation) or becomes plain optional. Recommend keeping Option-typed decoded fields — the getters and docs are built around it |
| `Schema.optionalWith(X, { default: () => HashMap.empty() })` | dependency maps, scripts | v4 decoding-default mechanism (field-level `decodeTo` with default getter) |
| `Schema.transform` / `transformOrFail` + `Schema.typeSchema(X)` | version, dependency-map, person, package-manager, wire schema | v4 `Schema.decodeTo`/`encodeTo` with transformations; the `typeSchema` trick to target a class disappears |
| `Schema.String.pipe(Schema.filter(pred \|\| "msg"), Schema.brand("X"))` | name, license, dependency-specifier | v4 `.check(...)` + `Schema.brand`; error messages via annotations |
| `Schema.Data(Schema.Record(...))` for `rest` | `Package.ts` | Re-evaluate: v4 may allow modeling the open remainder without the `Data.struct` cast + `disableValidation` construction; the wire-transform approach (partition keys, flatten on encode) still works under `decodeTo` |
| `Schema.decodeUnknown(...)` + `mapError` to domain error | reader, `setLicense`, `decodeSpecifier` | `Schema.decodeUnknownEffect` + `Effect.catchTag("SchemaError", ...)` normalization at the boundary; keep the structured error as `cause`, not `message` string |
| `import { FileSystem } from "@effect/platform"` | reader/writer layers | v4: FileSystem lives in effect core — the `@effect/platform` peer disappears entirely; consumers provide `@effect/platform-node` (or bun) at the edge |
| `NodeFileSystem.layer` in tests | `__test__/utils/layers.ts` | `@effect/platform-node` stays a devDependency for integration tests |
| Anonymous `Effect.gen` in service methods | reader/writer/validator impls | `Effect.fn("PackageJsonFile.read")(...)` etc. — none of the operations are named/spanned today; the port should instrument every service operation |
| Plain vitest + `runPromise` | all tests | `@effect/vitest` `it.effect`, top-level `layer(...)` groups, `Schema.toArbitrary`-driven property tests for the specifier taxonomy |
| `semver-effect` regular dep | package.json | `@effected/semver` `workspace:*`; also the chance to get a pure `Option`-returning range parse and kill the `Effect.runSync` in getters |

Semantics note: the four-error read ladder and the Option/HashMap-heavy decoded model are
*design* choices that survive v4 intact; the table above is mostly mechanical. The two
genuinely open v4 design questions are (a) Option-typed vs `optionalKey`-plain fields,
and (b) whether dependency maps stay `HashMap` (immutable, Effect-idiomatic, but every
consumer pays `HashMap.get`/`Option` friction for what is on disk a plain record). The
current HashMap choice is coherent with the Option-everywhere model; keep it, but decide
deliberately.

---

## 4. Candidate module-per-concept layout

Recommended: **one package** (see §5), with the IO surface isolated in a single module.

```text
@effected/package-json
src/
  index.ts                 # re-exports only (single entry point; kill ./schema)
  Package.ts               # Schema.Class model, getters, dual mutation statics,
                           #   copyWith (derived patch type), resolve, wire schema +
                           #   makeSchema (the .extend() story), PackageDecodeError
  PackageName.ts           # PackageName/Scoped/Unscoped brands; statics: isValid,
                           #   scope, unscoped, isScoped; InvalidPackageNameError
  DependencySpecifier.ts   # brand + single protocol taxonomy (protocolOf, isGit,
                           #   isLocal, isRange, isTag as statics), decode helper,
                           #   InvalidDependencySpecifierError
  Dependency.ts            # ONE Dependency class with kind field + protocol getters;
                           #   UnresolvedDependency type + guard
  License.ts               # SpdxLicense brand + InvalidSpdxLicenseError
  PackageManager.ts        # class + string codec
  Person.ts                # class + shorthand-string codec (wired into Package.author/
                           #   contributors this time)
  DevEngines.ts            # DevEngine class + devEngines field schema
  PackageValidator.ts      # Context.Service + layer, ValidationRule, defaultRules,
                           #   noLocalDepsRule, noUnresolvedDepsRule,
                           #   PackageValidationError (+ RuleFailure)
  CatalogResolver.ts       # Context.Service + no-op layer
  WorkspaceResolver.ts     # Context.Service + no-op layer, DependencyResolutionError
  PackageJsonFile.ts       # THE ONLY IO MODULE: one Context.Service with read/write
                           #   (merges Reader+Writer), layer over core FileSystem;
                           #   PackageJsonReadError / NotFoundError / ParseError /
                           #   WriteError; composite convenience layer
  internal/
    fields.ts              # small anonymous field codecs: bin, engines, exports,
                           #   publishConfig, scripts, dependency-map record<->HashMap
    format.ts              # canonical key order + dependency sorting + empty-map
                           #   stripping as pure functions (Formatter/Transformer
                           #   services dissolve; exposed as write options and/or
                           #   Package.toJsonString(options))
```

Consolidation score vs today: 34 src files → ~14; 10 error files → errors live with
their concepts; 7 services → 4 (`PackageJsonFile`, `PackageValidator`, two resolvers);
`Formatter`/`Transformer` become pure internal functions surfaced as options.

If the split is taken anyway, the seam is exactly one module:

```text
@effected/package-json       (pure)      everything above except PackageJsonFile.ts
@effected/package-json-fs    (boundary)  src/index.ts + src/PackageJsonFile.ts
                                         (+ its four IO errors); workspace dep on
                                         @effected/package-json; peers: effect
```

---

## 5. Pure-representation vs IO split: recommendation

**Recommendation: do not split. Ship one boundary-tier package with a pure core and a
single IO module.** Revisit only if a concrete pure-only consumer materializes.

Evidence:

- **The IO surface is tiny and already cleanly separated.** The only code that touches
  `FileSystem` is `PackageJsonReaderLive` (60 lines) and `PackageJsonWriterLive`
  (55 lines) — and the writer is mostly a pure pipeline (resolve → encode → transform →
  format → stringify) with one `fs.writeFileString` at the end. Everything else —
  schemas, model, taxonomy, formatting, validation, resolver *interfaces*, even
  `Package.resolve` — is pure. A second package would contain roughly one service with
  two methods.
- **The v3 motivation for splitting evaporates in v4.** Today the IO half forces the
  `@effect/platform` peer onto every consumer, including pure ones. In v4, `FileSystem`
  is in effect core, so the pure package and the boundary package have the *identical*
  peer closure: `effect`. Peer hygiene no longer distinguishes them; only the tier label
  does.
- **Splitting costs are real**: paired versioning/changesets across two packages, a
  workspace edge to design, doubled release surface, and consumers of the file API
  needing two installs — to isolate ~115 lines.
- **The tier taxonomy is satisfiable within one package**: classify
  `@effected/package-json` as boundary tier, and document that only `PackageJsonFile`
  performs IO. `sideEffects: false` + one IO module means bundlers tree-shake the fs code
  out of pure usage anyway.
- **What the split would buy** is a pure-tier package usable in browser/edge contexts
  with a guarantee that no code path can perform IO, and a cleaner story if e.g.
  pnpm-plugin-effect or silk tooling wants only the representation. But even the
  single-package form imposes no runtime Node dependency on pure consumers — `FileSystem`
  is a service key, not an fs import.

Two design changes should land regardless of the split decision, because they *are* the
pure/IO boundary:

1. **Move resolution out of `write`.** The writer's implicit `Package.resolve` is the
   only place pure logic and IO are fused today. Make `write` write, and resolution an
   explicit pure-with-R step callers compose.
2. **Expose the pure serialization path** (`Package` ↔ formatted JSON string) as
   first-class API — decode-from-string and encode-to-string with formatting are pure and
   currently only reachable through the fs-coupled reader/writer.

If a future consumer demands a pure package, the layout in §4 makes the split a
one-module extraction rather than a redesign.

## 6. Peer/dependency hygiene

Current state (`package.json`):

- `peerDependencies`: `effect` (catalog:silkPeers), `@effect/platform`
  (catalog:silkPeers) — **complete for its direct v3 usage**; both are also
  devDependencies for local dev, which is correct.
- `dependencies`: `semver-effect ^0.3.1`, `spdx-expression-parse ^4.0.0`.
- Transitive peer closure: `semver-effect` declares a single peer (`effect`), which
  package-json-effect re-declares as its own peer — the closure **holds**; no unfulfilled
  transitive peers escape to the consumer (the systems#228 / vitest-agent#127 failure
  mode is avoided).
- `@effect/platform-node` is devDependencies-only (tests), correctly left out of peers.

Target state for the port:

- `peerDependencies`: `effect` (catalog v4) only — `@effect/platform` ceases to exist as
  a peer in v4 since FileSystem moves into core.
- `semver-effect` → `@effected/semver` as `workspace:*`; decide the peer-vs-regular edge
  at design time per standards (regular dependency is the natural fit since `SemVer`
  instances appear in the public API — but that argues for *peer* if consumers also
  construct `SemVer`s and instance identity/version skew matters; flag for the design
  doc).
- `spdx-expression-parse` stays a regular dependency (pure, no peers of its own); its
  hand-written `.d.ts` shim (`types/spdx-expression-parse.d.ts`) comes along or gets
  replaced by a vendored validator in `src/internal/`.
- `@effect/platform-node` and `@effect/vitest` as devDependencies for `it.effect` +
  integration tests.
