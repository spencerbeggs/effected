---
type: Module
title: package-json
description: package.json parsing, editing, validation and file IO as Effect schemas — the kit's boundary-tier manifest library and its reference for pure/IO separation.
status: stable
kind: package
resource: ../../packages/package-json
tags:
  - dx
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-27T06:20:52Z
  body_sha256: 68ab8d3520cae816d68b4477e423396925babeb542cbc2aff362f050c8237e4f
---

# package-json

## Purpose

`@effected/package-json` is package.json parsing, editing, validation and file IO as Effect schemas. The rich `Package` `Schema.Class` is the domain model: computed getters, immutable-mutation statics, a round-trip-fidelity `rest` catch-all and semantic field decoding. All IO is confined to a single module, `PackageJsonFile.ts`.

## Tier and dependency posture

Boundary tier, set by the file IO in `PackageJsonFile.ts` and nothing more — the package carries no third-party runtime dependency outside `effect` core. Its `@effected` edges (`@effected/npm`, `@effected/semver`, `@effected/spdx`, `@effected/jsonc`, all `workspace:^`) are to pure and boundary packages, and the dependency policy's tier propagation applies only to tier-3 (integrated) edges, so none of them lifts this package's tier.

`effect` is the only peer — there is no `@effect/platform` peer, because `FileSystem` and `Path` live in core. `@effect/platform-node` stays a devDependency for integration tests that provide a real filesystem; consumers of the file API supply their own platform implementation at the edge. The IO is deliberately not split into its own package: in v4 the motivation for that split evaporates, since platform abstractions already live in core, so a hypothetical fs-only package would carry the identical peer closure as the whole package does now, and `"sideEffects": false` already lets bundlers tree-shake the fs code out of pure usage.

Core SPDX license validity is delegated to [`@effected/spdx`](spdx.md); see [the SPDX-delegation decision](../decisions/spdx-delegation.md).

## Module layout

Module-per-concept, one class or concept per file:

- `Package.ts` — the core model, the wire transform and `.extend()` story, and the reusable `@public` field codecs.
- `PackageManifest.ts` and `LenientManifest.ts` — the two more permissive tiers; see [the tolerance ladder](#the-tolerance-ladder).
- The leaf concepts: `PackageName.ts`, `License.ts`, `PackageManager.ts`, `PackageManagerRange.ts` (with `InvalidPackageManagerRangeError`), `Person.ts`, `Repository.ts` (holding both `Repository` and `Bugs`, since they share the shorthand-or-object encoding and the wire-provenance machinery), `Funding.ts`, `DevEngines.ts`, `Dependency.ts`.
- `PackageValidator.ts` — the validation service, its rule interface, the default rule set and a parameterized layer factory.
- `PackageJsonFile.ts` — the only IO module: one service, read/write over core `FileSystem`/`Path`, plus its error tags.
- `EntryPoint.ts` — entry-point resolution, pure and IO-free, and the one module whose input is deliberately structural rather than a `Package`. See [the entry-point resolver interface](../interfaces/package-json-entry-point.md).
- `PackageJsonFormat.ts` — the decode-free text seam: formatting and surgical edits, neither of which decodes. See [the decode-free text path interface](../interfaces/package-json-text.md).
- `internal/format.ts` — the pure canonical-key-order, map-alphabetizing and empty-map-stripping functions shared by the write options, the model's serializer and the format seam.
- `internal/wire.ts` — the `rest`-partitioning wire codec builder, shared by `Package` and `PackageManifest` so the two tiers cannot drift on what round-trips.

The package ships a single entry point; there is no `./schema` subpath. `DependencySpecifier` is not defined here — the specifier taxonomy lives in `@effected/npm`, because `@effected/lockfiles` is its second consumer — and `index.ts` re-exports it for surface compatibility, alongside `@effected/jsonc`'s `JsoncEdit`/`JsoncPath` since a caller applying `modify`'s edits needs them without declaring a jsonc edge of their own.

## Effect-wrapping policy

Pure synchronous where nothing can fail; `Effect` where the error channel is real, including all service IO; no `Effect.runSync` inside a getter, ever. Pure and synchronous: the computed getters, the specifier-taxonomy statics, the name predicates, the format functions and the serializer — absence is `Option` or a plain optional field, never a wrapping `Effect`. `Effect`: the mutation statics that validate, `Package.resolve`, decode-from-unknown, and every file and validator operation. Range detection inside the specifier taxonomy decodes semver's range codec purely via `Schema.decodeUnknownExit` plus an exit check, so no effect runs inside a getter even at that one sharp edge.

## Package

The `Package` `Schema.Class` carries: computed getters over privacy, scoping, module format and dependency lookup; immutable mutation statics using the dual-signature idiom (`Function.dual`, so data-first, curried and pipeable call styles all work); `copyWith`, taking a patch type derived from the fields rather than a hand-maintained partial that silently omits half of them; `resolve` — the static-with-`R` that turns `catalog:` and `workspace:` specifiers into concrete ranges from resolver services in context, the one place the pure model reaches into DI, deliberately not fused into `write`; `rest`, the catch-all preserving unknown top-level fields across a read/edit/write cycle; and `toJsonString`, the pure serialization path, reachable independent of the writer.

`publishConfig` is modeled as an open `Schema.Record` rather than a typed open struct, because a typed open struct does not annotate cleanly for a zero-warning `issues.json`; round-trip fidelity is fully preserved, and the only cost is that typed field access is dropped. `v4 Schema.Class` instances are not `Pipeable` out of the box, so `Package` retains a manual `pipe` overload block.

## Leaf concepts

**`PackageName`** brands the npm name grammar with scoped and unscoped refinements, written with lookahead-free regexes so `Schema.toArbitrary` property tests derive; its statics attach via `Object.assign` since a `const` and a `namespace` cannot merge in TypeScript. The locally owned branded types — `ScopedPackageName`, `UnscopedPackageName` and `SpdxLicense` — export as `string & Brand.Brand<"…">`, never as `typeof X.Type`, so the built `.d.ts` names a readable brand rather than an inlined schema projection; `DependencySpecifierBrand` follows the same shape but is defined in `@effected/npm` and only re-exported here.

**`SpdxLicense`** (in `License.ts`) validates the `license` field, delegating core SPDX-expression validity to `@effected/spdx` and keeping only the npm-specific `UNLICENSED` and `SEE LICENSE IN <file>` cases, which are npm semantics rather than SPDX grammar — see [the SPDX-delegation decision](../decisions/spdx-delegation.md). A branded `SpdxLicense` is therefore not necessarily parseable as SPDX, and `licenseExpressionOf(license) => Option<SpdxExpression>` is the accessor for turning a branded value into an actual expression when one is needed, yielding `none` for a spelling that is not an expression. The implementation deliberately contains no screen for npm's two special cases: the SPDX grammar already declines both, so discarding the parse failure is the screen, and the day npm admits a third special case the grammar answers "not an expression" for it too with no change here.

**`PackageManager`** parses corepack's `<name>@<version>[+<integrity>]` triple. Both strict halves are shared by identity with the packages that own them rather than re-derived: the version field is `@effected/semver`'s `SemVer.PinnableVersionString`, and integrity is `@effected/npm`'s `CorepackIntegrityHash`. That sharing is runtime-asserted by identity, not by source text, because a `Schema.check` is erased from the built `.d.ts` and severing either schema would be neither a type error nor a compile-time-visible break — see [the identity invariant](../invariants/package-manager-shares-strict-schemas-by-identity.md). The name grammar is the one place this model and npm's pin diverge, deliberately: the field model keeps any lowercase name (manifests as they exist in the wild), while the pin closes the set to four (the kit's own provisioning vocabulary) — corepack itself recognizes only three names and would reject the very real `bun@…`, and npm documents no constraint on this field.

**`Person`** parses the `"Name <email> (url)"` shorthand into structured fields and encodes back. **`Repository` and `Bugs`** accept npm's string-or-object encodings; `Bugs.url` is optional because an email-only entry is legal, while a model requiring a URL would reject valid manifests. `homepage` is a plain string with nothing to model.

**`Dependency`** is one class with a `kind` field rather than four near-identical tagged classes, so the protocol getters are written once and delegate to npm's specifier taxonomy.

### Repository carries the reference verbatim

`Repository` holds the reference verbatim and exposes normalization as derived getters, so reading a manifest never rewrites the field and a caller that wants a link asks for one explicitly. `directoryUrl` descends `browseUrl` into `directory` for the monorepo-member case: with no `directory`, `directoryUrl` is `browseUrl` (a correct answer, not a missing one); with `directory` on a known host (GitHub's `tree/HEAD`, GitLab's `-/tree/HEAD`, Bitbucket's `src/HEAD`), it is the descended URL, using `HEAD` because the default branch is not knowable from a manifest and every one of these hosts resolves `HEAD` to it; with `directory` on any other host, or one containing `..`, it answers `Option.none()` rather than fabricating a path for an unrecognized forge — what to do with that `none` is left to the caller, since falling back to `browseUrl` is reasonable in some contexts and wrong in others.

### Wire provenance, and why the replay is guarded

`Person`, `Repository`, `Bugs` and `Funding` each remember the exact wire value the instance decoded from, in a `WeakMap`, and replay it on encode for byte-level fidelity. The replay must be guarded on the value still matching its provenance: `Schema.Class` instances are not frozen at runtime, so an instance mutated in place keeps a provenance entry that no longer describes it, and an unguarded replay would silently write the original value back, discarding the edit. Every class guards every replay branch — shorthand string and object alike. Two lessons carry it: a guard on one branch is not a guard (the object branch is the boring one and is where an unguarded replay hides), and every replay branch needs its own mutate-in-place test, because a test that rebuilds the value with a spread cannot reach the replay path at all.

**Provenance keys must be leaf instances, never rebuilt containers.** A `decodeTo` target of `Schema.Array(...)` or `Schema.Struct(...)` does not preserve the object identity the transform returned — the container is rebuilt on the way out — so a `WeakMap`/`WeakSet` keyed on it is empty by the time `encode` runs, with no error or warning, just a fidelity guarantee that silently degrades to the canonical form. `Funding` is the worked example: the field's arity provenance (was this written bare, or as an array?) rides the single entry that was the field, never the decoded array. An edited shorthand re-emits as a shorthand; the object form is the fallback only when the shorthand genuinely cannot carry the value, because shape fidelity is the promise and data fidelity outranks it only in the one case where they conflict — one predicate decides both, deliberately, so a person cannot be refused the replay yet handed back as a shorthand that silently drops the very keys the refusal detected.

### Funding

npm's `funding` field accepts a bare URL string, an object with `url` and an optional `type`, or an array mixing either; the model normalizes the **read** side only, so `Funding.FromField` always decodes to an array and no consumer branches on arity. The **write** side is deliberately not normalized: a lone entry read bare re-encodes bare, and an entry read from the string form re-encodes to that exact string, honoring the fidelity obligation that a formatter must not rewrite one legal encoding into another. `url` is required, unlike `Bugs.url` — the two look parallel and are not, since an email-only `bugs` entry is legal npm, while npm's funding object carries no other way to say where the money goes, so an entry without a url is a decode failure rather than a partially-populated value.

## The compliance field set

The modeled field set is scoped to every manifest field a named consumer's mapping reads, drawn first from `@effected/sbom`'s CycloneDX 1.6 plus NTIA-minimum-elements metadata-source mapping rather than a general sweep of npm's documentation: name, version, description, license, author, contributors, maintainers, keywords, repository, bugs, homepage, and — since a second mapping target appeared — `funding`. `funding` is the worked example of the scope rule: CycloneDX 1.6 has no funding external-reference type, so under the first mapping the field had no target and was excluded with its release condition recorded ("it earns its place the day a consumer names a target for it"); `tsdoctor` later named one (schema.org's `funding` property, emitted into a documented package's JSON-LD), so the field was modeled under the rule as written, not by relaxing it. The scope rule is "something consumes it," not "CycloneDX 1.6 or nothing" — a second mapping target is a legitimate way to satisfy it, and a recorded exclusion with a stated condition is what makes adding a field cheap later.

## The tolerance ladder

The kit's package.json tolerance ladder, strictest to most permissive, spans five surfaces that all read the same document:

- **`Package`** — strict, publishable: `name`/`version` required, every present field shape-validated against its npm grammar.
- **`PackageManifest`** — presence-lenient: fields may be absent (the private workspace-root shape), but a present field is still shape-validated exactly as strictly as `Package`'s. It relaxes exactly two things: `name` and `version` become optional, and `packageManager` decodes through `PackageManagerRange` instead of the exact pin.
- **`LenientManifest`** — shape-lenient discovery/sniffing: a present field that fails even its permissive shape check degrades to absence rather than failing the whole document — degradation granularity is the top-level field, and the malformed value is preserved verbatim in `rest` as though it were an unknown key — with the degradation recorded on `issues` as a `LenientFieldIssue`. The sync primitives are `decodeResult`/`parseResult`, with `Effect.fn`-spanned `decode`/`parse` derived from them; there are no mutation statics and no write path, and the upgrade path is re-decoding the original input through `PackageManifest.decode` or `Package.decode`. Leniency is per-field, never per-syntax: text that fails to `JSON.parse` fails typed as `PackageJsonSyntaxError`, and a parsed non-object value fails typed as `PackageDecodeError`. An empty `issues` array does not imply the strict tiers would accept the document — the permissive guards check JSON shape, not npm semantics (no SPDX validity, no semver grammar, no npm name grammar).
- **`@effected/npm`'s `Manifest`** — shape-blind outside the four dependency fields, for mid-build resolution.
- **`PackageJsonFormat`** — the decode-free text path: anything syntactically JSON, no field validation at all. See [the decode-free text path interface](../interfaces/package-json-text.md).

`PackageManagerRange` models pnpm's own wider reading of `packageManager` under `manage-package-manager-versions` (a semver range, not just an exact pin), as a separate class from `PackageManager` rather than one loosened field — so a caller asking "can corepack provision this?" still gets a typed answer from the strict class. It shares `PackageManager`'s one load-bearing rule: the first `+` after the `@` begins the integrity component, never semver build metadata.

It reads two fields through one component validation, so they cannot drift apart. `parseResult(input)` (a sync `Result`, the primitive under `parse` and the `FromString` codec) reads a `packageManager` string. `fromDevEngineResult(engine)` (under `fromDevEngine`) reads a `devEngines.packageManager` entry, whose `name` is the manager and whose `version` holds the same `<range>[+<integrity>]` tail. An entry with no `version` names no range, so it fails; `onFail` is ignored. Every entry point fails with `InvalidPackageManagerRangeError`, whose `reason` names the component: `format` (a string with no `@`), `name`, `range` (absent, empty, or not a semver range) or `integrity` (the tail is not a corepack `<algo>.<hex>` hash). An empty range is a `range` failure, never the `*` node-semver would coerce it to. `FromString` still reports a generic `SchemaError` carrying the same message.

Three renderings serve three writers. `toString()` is the value as parsed, integrity included, and is what `FromString` encodes. `bare` is `<name>@<range>` with the integrity dropped and the operator kept. `range` alone is the bare `devEngines.packageManager.version` value, so `^12.6.0+sha512.<hex>` writes back as `^12.6.0`.

## The `rest` catch-all and `.extend()` story

`Package` carries a `rest` field holding unknown top-level keys. The wire transform partitions raw object keys against `Class.fields`: known keys decode to typed members, the remainder flow into `rest`; on encode, `rest` flattens back out to top-level keys, so there is never a literal `rest` key on disk. Because the partition is against `Class.fields`, `.extend()`ed subclasses automatically pull their new fields out of `rest` into typed members — the codec is rebuilt against the subclass's fields. `rest` itself is a plain optional record: no `Schema.Data` cast, no disabled validation.

The catch-all is needed at every level a round-tripped document has, not just the top: a `Schema.Class` modeling a sub-object (`Person` for object-form `author`/`contributors`/`maintainers`) needs its own `rest`, or unknown keys inside that object silently drop on read→write (`{"name":"Dee","twitter":"@dee"}` re-encoding as `{"name":"Dee"}`). `Person` collects them into `rest` and flattens them back on encode, so the on-disk shape never carries a literal `rest` key there either; check every new sub-object class against a round-trip test.

## Optional-field and dependency-map representation

Omissible object fields decode via `Schema.optionalKey` with implementation-level defaults; a `Schema.Option`-typed decoded field survives only where presence versus absence is actively branched on in the model's logic. The dependency maps and `scripts` are `HashMap`s — immutable, Effect-idiomatic, structural equality for free. The record-to-HashMap codec sits its decoding default on the record side, before `decodeTo`, taking an `Effect`; applying the default after the HashMap decode breaks the encode direction. Empty maps are stripped on encode.

## Dual-signature statics

The mutation statics use `Function.dual` so data-first, curried and pipeable call styles all work, reusing the machinery proven in `@effected/semver`.

## Error set

Each error is a `Schema.TaggedError` defined in the module of the concept that raises it, keeping its `message` getter. Structure-preserving discipline is the rule that matters: decode and read/write errors carry the underlying failure as a structured `cause` field, never a stringified message. `SchemaError` is normalized to the domain error at the boundary via `Effect.catchTag`, never leaked deep into logic. Not-found keeps its own tag for routing, the write error is narrowed to the fs-write failure only, and the read path folds decode failures into the shared decode error rather than minting a second one.

## Services and layers

Layers are exported as consts inside each concept module, memoized by reference (never getters) and provided at boundaries only — business logic requires services and never calls `Effect.provide` locally. `PackageJsonFile` is the only IO service, working over core `FileSystem`/`Path` so its layer requires no platform peer. It carries three pairs of operations against a path: the strict `read`/`write`, the presence-lenient `readManifest`/`writeManifest`, and the byte-preserving `modify` (see [the decode-free text path interface](../interfaces/package-json-text.md)) — so a caller picks a tolerance tier without leaving the service. Write creates the parent directory before writing, and both steps fail as the narrowed write error. Read deliberately has no `exists` pre-check — that is a TOCTOU window — and instead reads the text directly, routing only the `PlatformError` whose `reason._tag` is `"NotFound"` to `PackageJsonNotFoundError`. Resolution is deliberately kept out of `write`: write writes what it is given, and resolution is an explicit step the caller composes, since a writer that silently resolved would make writing a file mutate its contents. The resolver services are not defined here — `Package.resolve` imports the tags from `@effected/npm` and requires them from context, per [contract inversion](../decisions/contract-inversion-default.md).

## The decode-free text path

Formatting and surgical field edits both work on manifest text and never decode, which is what makes them usable where `Package.decode` hard-fails on legal input (`{"private": true}` and version-less roots are both perfectly valid manifests that the strict decode rejects). Both live in `src/PackageJsonFormat.ts` and are reachable from `PackageJsonFile` against a path. See [the package-json-text interface](../interfaces/package-json-text.md) for the byte-parity rule, indentation options and edit conventions.

## Observability

Per the kit's observability standard, `Effect.fn("name")` at public fallible boundaries: every file operation, validation, resolution, the effectful mutation statics and the decode entry. Pure getters, the specifier taxonomy and the format functions are not instrumented. The library stays telemetry-agnostic; applications compose `@effect/opentelemetry` at the edge.

## Testing

`@effect/vitest` with `it.effect` the default mode; shared wiring via top-level `layer(...)` groups, scoped and memoized. Tests in `__test__/` split per concept, integration under `__test__/integration/`. Property tests cover the specifier taxonomy and name-brand validation. Round-trip and wire-transform tests assert the fidelity contract structurally — unknown fields survive read/edit/write, subclasses pull custom fields out of `rest`, empty maps strip and keys land in canonical order — rather than through brittle output snapshots. Integration tests with a real platform filesystem layer are the only tests that provide one, making the boundary discipline explicit. Error-path and behavior-contract tests cover each read error tag, validation aggregation, structured cause preservation, the dual-signature call styles, `copyWith` completeness, resolution with real versus no-op resolvers, and the contract that writing does not mutate contents.

## Build

Every Effect class factory is written inline with no exported `*_base` const; the synthesized `_base` heritage symbols are suppressed narrowly in `savvy.build.ts`. `pnpm build --filter @effected/package-json` runs the dev+prod pipeline; never invoke `node savvy.build.ts --target prod` directly.
