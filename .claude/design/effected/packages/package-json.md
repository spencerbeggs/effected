---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../formatter-convention.md
  - semver.md
  - jsonc.md
  - npm.md
  - spdx.md
  - sbom.md
---

# @effected/package-json design

## Overview

`@effected/package-json` is package.json parsing, editing, validation and file IO as Effect schemas — a **boundary-tier** manifest library and the kit's reference for pure/IO boundary discipline. The rich `Package` `Schema.Class` is the domain model: computed getters, immutable-mutation statics, a round-trip-fidelity `rest` catch-all and semantic field decoding. All IO is confined to a single module.

## Tier and dependencies

**Boundary tier, set by the file IO in `PackageJsonFile.ts` and nothing more** — the package carries no runtime dependency outside `effect` core. Its `@effected` edges (semver, npm and spdx, all `workspace:^`) are to pure packages, and [R2 propagates only tier-3](../effect-standards.md#dependency-policy), so none of them lifts the tier.

`effect` is the only peer: there is **no `@effect/platform` peer**, because `FileSystem` and `Path` live in core. `@effect/platform-node` stays a devDependency for integration tests that provide a real filesystem; consumers of the file API provide their own platform implementation at the edge.

**The IO is deliberately not split into its own package.** In v4 the motivation evaporates: platform abstractions live in core, so a pure core and a hypothetical fs package would have the identical peer closure, and splitting would isolate a hundred-odd lines of IO behind paired versioning for no gain. `"sideEffects": false` already lets bundlers tree-shake the fs code out of pure usage. It remains a one-module extraction if that ever changes.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept). Each concept file owns its `Schema.Class` models, the errors that concept raises and — if it is a service — the `Context.Service` class plus its layers.

- `Package.ts` — the core model, the wire transform and `.extend()` story, and the reusable `@public` field codecs.
- `LenientManifest.ts` — the shape-lenient discovery tier; see [the tolerance ladder](#the-tolerance-ladder-and-lenientmanifest).
- The leaf concepts: `PackageName.ts`, `License.ts`, `PackageManager.ts`, `Person.ts`, `Repository.ts`, `DevEngines.ts`, `Dependency.ts`. `Repository.ts` holds both location models, because they share the shorthand-or-object encoding and the wire-provenance machinery and splitting them would duplicate it.
- `PackageValidator.ts` — the validation service, its rule interface, the default rule set and a parameterized layer factory.
- `PackageJsonFile.ts` — **the only IO module**: one service, read and write over core `FileSystem`/`Path`, plus its error tags.
- `EntryPoint.ts` — [entry-point resolution](#resolveentrypoint-exports-encapsulates-the-package), pure and IO-free, and the one module whose input is deliberately *structural* rather than a `Package`.
- `PackageJsonFormat.ts` — the **decode-free** formatting seam. See [the formatting seam](#the-decode-free-formatting-seam).
- `internal/format.ts` — the pure canonical-key-order, map-alphabetizing and empty-map-stripping functions shared by the write options, the model's serializer and the format seam. Holds the key order and its provenance comment.

The package ships a single entry point; there is no `./schema` subpath, and field codecs are either `@public` consts on their owning concept or `internal/` privates. **`DependencySpecifier` is not defined here** — the specifier taxonomy lives in [`@effected/npm`](npm.md), because lockfiles is its second consumer; `index.ts` re-exports it for surface compatibility.

## Effect-wrapping policy

The [jsonc/yaml wrapping policy](jsonc.md#effect-wrapping-policy) applies, adapted for a service-bearing boundary library: **pure synchronous where nothing can fail; `Effect` where the error channel is real, including all service IO; no `Effect.runSync` inside a getter, ever.**

Pure and synchronous: the computed getters, the specifier-taxonomy statics, the name predicates, the format functions and the serializer. Absence is `Option` or a plain optional field, never a wrapping `Effect`.

`Effect`: the mutation statics that validate, `Package.resolve`, decode-from-unknown and every file and validator operation.

The one place this could quietly break is range detection inside the specifier taxonomy, which decodes semver's range codec **purely** via `Schema.decodeUnknownExit` plus an exit check — so no effect runs inside a getter.

## Package

The rich `Schema.Class`, and the single best DX pattern in the repo:

- **Computed getters**, pure, over privacy, scoping, module format and dependency lookup.
- **Immutable mutation statics** with the [dual-signature idiom](#dual-signature-statics); the effectful ones fail typed.
- **`copyWith`** takes a patch type *derived from the fields*, not a hand-maintained partial that silently omits half of them.
- **`resolve`** — the static-with-`R` that turns `catalog:` and `workspace:` specifiers into concrete ranges from resolver services in context. It is the one place the pure model reaches into DI, and it is deliberately **not** fused into `write`.
- **`rest`** — the catch-all preserving unknown top-level fields across a read/edit/write cycle. See [the wire transform](#the-rest-catch-all-and-extend-story).
- **`toJsonString`** — the pure serialization path, first-class rather than only reachable through the writer.

`publishConfig` is modeled as an **open `Schema.Record`** rather than a typed open struct: a typed open struct runs in v4 but does not annotate cleanly for a zero-warning `issues.json`. Round-trip fidelity is fully preserved; the only cost is that typed field access is dropped, and consumers read off the open record. That constraint does not arise for a `Schema.Class` with its own codec, which is why `repository` is typed.

## Leaf concepts

**`PackageName`** brands the npm name grammar with scoped and unscoped refinements, written with **lookahead-free regexes** so `Schema.toArbitrary` property tests derive. Its statics attach via `Object.assign`, since a `const` and a `namespace` cannot merge in TS, and the branded types export explicitly as `string & Brand.Brand<"…">` rather than `typeof X.Type`.

**`SpdxLicense`** validates the `license` field, delegating core SPDX-expression validity to [`@effected/spdx`](spdx.md) and keeping only the npm-specific `UNLICENSED` and `SEE LICENSE IN <file>` cases, which are npm semantics rather than SPDX grammar.

**`PackageManager`** parses corepack's `<name>@<version>[+<integrity>]` triple. Both strict halves are **shared by identity** with the packages that own them rather than re-derived: the version field IS [semver](semver.md)'s `PinnableVersionString`, and integrity is [npm](npm.md)'s `CorepackIntegrityHash`, held in a genuine `Schema.Option` because absence is branched on. Sharing the version schema is a deliberate strictening — padded versions, leading zeroes and empty prerelease identifiers all fail typed now, matching corepack's own validity check minus its trim — and because the check sits on the *field*, `make` refuses a malformed version rather than producing a manifest value that re-parses differently.

That sharing is **runtime-asserted by identity**, not by source text, and the assertions must not be downgraded: a `Schema.check` is erased from the built `.d.ts`, so severing either schema would not be a type error and nothing else would catch it.

**The name grammar is the one place this model and npm's pin diverge, deliberately.** The field model keeps any lowercase name; the pin closes the set. Field model means *manifests as they exist in the wild*, pin means *the kit's provisioning vocabulary* — corepack itself recognizes only three names and would reject the very real `bun@…`, and npm documents no constraint on this field. The evidence lives in the class's TSDoc. Do not "align" it with the pin.

**`Person`** parses the `"Name <email> (url)"` shorthand into structured fields and encodes back. **`Repository` and `Bugs`** accept npm's string-or-object encodings; `Bugs.url` is optional because an **email-only entry is legal** and a model requiring a URL would reject valid manifests. `homepage` is a plain string — there is nothing to model.

**`Dependency`** is **one** class with a `kind` field rather than four near-identical tagged classes, so the protocol getters are written once and delegate to npm's specifier taxonomy.

### `Repository` carries the reference verbatim

`Repository` holds the reference **verbatim** and exposes normalization as derived getters. That split is the point: reading a manifest never rewrites the field, so the [fidelity obligation](../formatter-convention.md#decision-5--the-fidelity-obligation) holds, while a caller that wants a link asks for one.

Those getters return `Option`, because `repository` is caller data and a value we cannot interpret is a **missing answer rather than a failure** — the posture the kit takes on absence everywhere else. The recognized forms cover bare and host shorthands, the `git+https` / `git` / `git+ssh` / scp-like URL spellings and the object form.

`RepositoryField` stays exported and `@deprecated`: `Package.repository` decodes through the typed codec, but the raw union stays named for any consumer matching on it.

### Wire provenance, and why the replay is guarded

`Person`, `Repository` and `Bugs` each remember the exact wire value the instance decoded from, in a `WeakMap`, and replay it on encode for byte-level fidelity.

**The replay must be guarded on the value still matching its provenance, and the guard is load-bearing rather than defensive.** `Schema.Class` instances are not frozen at runtime, so an instance mutated in place keeps a provenance entry that no longer describes it — and an unguarded replay writes the *original* value back, silently discarding the edit. A surviving mutant is what surfaced this: the guard was written, the test for it was not.

Two traps come with it, both recorded in the package CLAUDE.md and worth knowing before touching either class. The guard must treat `rest` as disqualifying for the shorthand branch, because a shorthand has no syntax for extra keys — the named fields still match, so without an explicit clause the added keys vanish on write. And a test that rebuilds with `make({ ...person, x })` **cannot catch any of this**, because it produces a new instance with no provenance and never reaches the replay path; the instance must be mutated in place.

An edited shorthand **re-emits as a shorthand**; the object form is the fallback only when the shorthand genuinely cannot carry the value. Shape fidelity is the promise — a manifest's `author` must not silently change representation because one field was edited — and data fidelity outranks it in the one case where they conflict. One predicate decides both, deliberately: split them and a person can be refused the replay yet handed back as a shorthand, dropping the very keys the refusal detected.

**Any object-shaped model inherits the catch-all obligation.** `Package`, `Person`, `Repository` and `Bugs` are the current set; every other leaf is a scalar or a closed shape. The rule, not the enumeration, is what governs — check every new sub-object class against a round-trip test.

## The compliance field set

The modeled field set is scoped to **every manifest field the CycloneDX 1.6 plus NTIA-minimum-elements mapping reads**, derived from [`@effected/sbom`](sbom.md)'s metadata-source mapping rather than from a general sweep of npm's documentation. Each field is present because something consumes it: name and version (which the `purl` also derives from), description, license, author, contributors, maintainers, keywords, repository, bugs and homepage.

**`funding` was evaluated and deliberately NOT added.** npm documents it, but CycloneDX 1.6 has no funding external-reference type — verified by enumerating the published type set, not from memory. A field with no target in the mapping would be exactly the arbitrary growth this scope rule exists to prevent; it earns its place the day a consumer names a target for it.

## The tolerance ladder and `LenientManifest`

The kit's package.json tolerance ladder, from strictest to most permissive, is documented once in `PackageManifest.ts`'s header comment and reproduced here because it is load-bearing for choosing between four surfaces that all decode the same document:

- **`Package`** — strict, publishable: `name`/`version` required, every present field shape-validated against its npm grammar.
- **`PackageManifest`** — presence-lenient: fields may be absent (the private workspace-root shape), but a present field is still shape-validated exactly as strictly as `Package`'s.
- **`LenientManifest`** — shape-lenient discovery/sniffing (this section): a present field that fails even its permissive shape check **degrades to absence** rather than failing the document.
- **`@effected/npm`'s `Manifest`** — shape-blind outside the four dependency fields, for mid-build resolution.
- **`PackageJsonFormat`** — the decode-free text path: anything syntactically JSON, no field validation at all.

`LenientManifest` exists for the discovery use case neither strict tier can serve: probing a fetched tarball's manifest, walking a `node_modules` tree, listing candidate packages — where the document is other people's data and one malformed field must not fail the whole read. Every field shares its name with `Package`, but is typed as its **plain permissive JSON shape** rather than the branded/validated one: `name` and `version` are any string (a legacy uppercase name or a non-semver `"1.0"` is recovered, not rejected), `license` is any string with no SPDX check, and the dependency maps, `scripts` and `engines` are plain `Record<string, string>` rather than the strict tiers' `HashMap`.

**Leniency is per-field, never per-syntax, and degradation is per-top-level-field.** Text that fails to `JSON.parse` fails typed as `PackageJsonSyntaxError`; a parsed value that is not a JSON object at all fails typed as `PackageDecodeError` — leniency does not cover either. Within an object, each top-level key is sifted independently against a `Map<string, FieldGuard>` of permissive-shape predicates: an unknown key or a known key whose value fails its guard both flow verbatim into `rest` (a malformed known field is treated exactly like an unknown one), and every degradation is additionally recorded on `issues` as a `LenientFieldIssue { field, expected, value }` so a caller can report what was ignored. One junk entry degrades its whole field — there is no per-array-element or per-map-entry leniency.

**An empty `issues` array does not imply the strict tiers would accept the document.** The permissive guards check JSON *shape*, not npm *semantics* (no SPDX validity, no semver grammar, no npm name grammar) — `LenientManifest` is a sniffing tier, not a validation bypass. The upgrade path when validation is actually wanted is re-decoding the *original* input through `PackageManifest.decode` (presence-lenient, shape-strict) or `Package.decode` (strict, publishable). Consistent with that posture, the class carries **no mutation statics and no write path** — editing belongs to the strict tiers and to `PackageJsonFormat.modifyToString` / `PackageJsonFile.modify`.

Sync primitives (`decodeResult`/`parseResult`) with `Effect.fn`-derived spans (`decode`/`parse`) follow the package-wide wrapping policy exactly like every other fallible surface here. Born from the tsdoctor-monorepo dogfood ask (round 1, item 3).

## The `rest` catch-all and `.extend()` story

`Package` carries a `rest` field holding unknown top-level keys. The **wire transform** partitions raw object keys against `Class.fields`: known keys decode to typed members, the remainder flow into `rest`; on encode, `rest` flattens back out to top-level keys, so there is never a literal `rest` key on disk.

Because the partition is against `Class.fields`, `.extend()`ed subclasses automatically pull their new fields out of `rest` into typed members — the codec is rebuilt against the subclass's fields. `rest` itself is a plain optional record: no `Schema.Data` cast, no disabled validation.

## Optional-field and dependency-map representation

Omissible object fields decode via `Schema.optionalKey` (the [schema standard](../effect-standards.md#schema-standards) default) with implementation-level defaults. A `Schema.Option`-typed decoded field survives only where presence versus absence is actively branched on in the model's logic.

The dependency maps and `scripts` are `HashMap`s — immutable, Effect-idiomatic, structural equality for free. The record-to-HashMap codec sits its decoding default on the record side, **before** `decodeTo`, taking an `Effect`; applying the default after the HashMap decode breaks the encode direction. Empty maps are stripped on encode.

## Dual-signature statics

The mutation statics use `Function.dual` so data-first, curried and pipeable call styles all work, reusing the machinery proven in [semver](semver.md). v4 `Schema.Class` instances are **not** `Pipeable` out of the box, so the class retains a manual `pipe` overload block — preserve it if you touch the class.

## Error set

Each error is a `Schema.TaggedError` defined in the module of the concept that raises it, keeping its `message` getter. See the source for the current set.

**Structure-preserving discipline** is the rule that matters: decode and read/write errors carry the underlying failure as a structured `cause` field, never a stringified message. `SchemaError` is normalized to the domain error at the boundary via `Effect.catchTag`, never leaked deep into logic. Not-found keeps its own tag for routing, the write error is narrowed to the fs-write failure only, and the read path folds decode failures into the shared decode error rather than minting a second one.

## Services and layers

The kit's first real exercise of the [services-and-layers standards](../effect-standards.md#services-and-layers-standards). Layers are exported as consts inside each concept module, memoized by reference (never getters) and provided at boundaries only — business logic requires services and never calls `Effect.provide` locally.

`PackageJsonFile` is the only IO service, working over **core** `FileSystem`/`Path` so its layer requires no platform peer. Write creates the parent directory before writing, and both steps fail as the narrowed write error. `PackageValidator` carries a default rule set plus a genuinely-parameterized layer factory. The resolver services are **not defined here** — `Package.resolve` imports the tags from [`@effected/npm`](npm.md) and requires them from context.

Two boundary properties are load-bearing:

1. **Resolution is out of `write`.** Write writes what it is given; resolution is an explicit step the caller composes. A writer that silently resolved would make *writing a file mutate its contents*.
2. **The formatter and transformer are pure functions, not services** — surfaced as write options and as the model's serializer.

## Formatting: byte-agreement with the ecosystem oracle

The formatter's job is not "a reasonable order" — it is **the order the ecosystem already produces**, so running the kit's writer over a repo does not churn every manifest against whatever the team's `sort-package-json` pre-commit hook does next.

The canonical top-level key order is `sort-package-json`'s default sort order, **re-baselined verbatim**, with the version recorded as provenance beside the list. Verbatim is the point: a hand-curated *near*-copy is the shape that drifts silently, since every disagreement shows up as a diff in someone's repo rather than as a failure here. Unknown keys append after the known ones — public keys alphabetically, then underscore-prefixed keys alphabetically — matching the oracle's own behavior.

### Map-field alphabetization follows from HashMap, not taste

Sorting alphabetizes the dependency maps for canonical presentation, and `scripts`, `engines` and `bin` join them for a stronger reason: the model carries all three as `HashMap`s, whose encode order is *hash* order. **Source order is already unrecoverable**, so the choice is not "preserve or sort" but "hash order or alphabetical", and deterministic alphabetical wins uncontested. The oracle sorts these identically, except that its `scripts` sort is a grouped one agreeing with plain code-unit order apart from `pre`/`post` pairing.

### `PackageIndent` and `"preserve"`

The indent option is `number | "tab" | "preserve"`. `"preserve"` reuses the source text's indentation, backed by an explicit source-text option — and the file writer supplies it by **reading the file it is about to overwrite** when the caller gives none. That read is the only way `"preserve"` can mean anything at a write site holding a decoded model and nothing else; without it the option would silently degrade to a default and quietly re-indent the file.

### The decode-free formatting seam

`PackageJsonFormat` exists because the strict path **hard-fails on legal input**: decode raises on `{"private": true}` and on version-less roots, both perfectly valid manifests. That makes the strict path unusable as a lint handler. This package is the only one of the kit's four formatters with a *schema* between text and text, so it is the only one where that can happen at all — the three format packages satisfy the constraint by construction.

Four properties are load-bearing, and they are [the kit formatter convention](../formatter-convention.md#the-rules) rather than local choices:

- **A distinct named entry point, never a `{ strict: false }` flag.** A flag would make the strict path's return type a union of guarantees and hide the choice from both the call site and `grep`.
- **Two shapes because two hosts exist** — value→value and bytes→bytes — routed through one internal sort so they cannot drift.
- **The value path only reorders; it never adds or removes a key.** That is what makes the `T → T` return type honest, and it is type-enforced: `tsc` rejects a key-removing option there. Stripping lives on the text path, defaulted **off**. Capabilities that delete are opt-in, always.
- **Input it cannot handle comes back unchanged**, never partially rewritten — a non-object degrades to identity instead of losing data.

The text path returns `Result`, not `Effect`: lint hosts are synchronous, and an `Effect` return would force every one of them to build a runtime to format a file. Effect hosts lift with `Effect.fromResult` in one call, so the `Result` serves both. Its options type is deliberately separate from the strict path's — a source-text option is meaningless when the text *is* the source — and where a default diverges, the divergence and its reason are documented on the member, because that is exactly where a silent edit hides.

### Byte-parity fixtures

`__test__/fixtures/` holds real manifests from this repo paired with frozen oracle output for the same input, and the format test asserts byte equality. **`sort-package-json` is deliberately not a dependency** — the oracle's *output* is committed, not the tool, so the parity claim is checked without taking a runtime edge on the thing being matched.

The **re-baseline rule** is that the fixtures, the recorded version in the fixture README and the key-order provenance comment move **together**, in one deliberate act. Regenerating fixtures alone would silently ratify whatever a newer version changed, turning the oracle test from a check into a rubber stamp.

## `resolveEntryPoint`: `exports` encapsulates the package

`resolveEntryPoint` answers one question — given a manifest, which file is the package's `"."` entry? — and it is **pure, IO-free and `Result`-returning**, per the [sync-primitive policy](../sync-primitive-policy.md). Nothing here touches a filesystem, so it is testable against plain manifest objects with no package on disk and it composes with a directory that arrived by any route. The route that motivated it is [`@effected/npm`](npm.md#packagetarball--reading-a-published-package-back)'s extracted tarball: read a published package's entry point before any install has run.

Three shapes are honoured because all three appear in real published packages — the string shorthand, the subpath map, and root conditions with no `"."` key — and conditions **recurse**, because `{ "import": { "node": "./n.js" } }` is legal and a non-recursive reader answers an object where a path belongs. The condition list is caller-supplied and **ordered**, so the order *is* the policy: `["require", "import"]` and `["import", "require"]` resolve the same manifest to different files, on purpose.

**The load-bearing semantic: a present `exports` encapsulates the package.** A root entry that matches none of the requested conditions is a **failure**, and does not fall through to `main`. That is Node's own rule, and it diverges from the lenient reading a consumer had shipped — under which a `require`-only package read with `["import"]` quietly resolved to a `main` Node itself would refuse to load. Because the divergence is the kind a future reader would "fix", **it is pinned by a test rather than only a docstring.**

**`UnresolvedEntryPointError` carries a discriminated `reason`** — `noRootExport`, `noConditionMatched` (naming the conditions tried) and `unsupportedExportsForm` — for the reason recorded on npm's side of the same composition: the three shapes call for different responses, and collapsing them into one sentinel is the same class of quiet wrong answer as an untyped error channel.

**The input type is structural, not `Package`.** `EntryPointManifest` is `{ exports?, main? }`, so a caller can resolve from a manifest parsed straight out of a tarball with nothing else validated yet. Requiring the strict model here would make the strictest decode in the package a precondition for its most tolerant use.

## Resolution belongs to @effected/npm

`Package.resolve` expands `catalog:` and `workspace:` specifiers, but resolution fundamentally requires workspace and catalog context a manifest-document library cannot have — hence the no-op defaults, which resolve nothing.

The contracts live in [`@effected/npm`](npm.md) rather than here for two reasons. [`@effected/workspaces`](workspaces.md) carries its own, differently-shaped resolution domain and would not natively implement package-json's minimal tags. And there are downstream uses for the contracts beyond package-json, which makes the second consumer real rather than speculative. Workspaces implements them as layers over its own services.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards), `Effect.fn("name")` at public *fallible* boundaries: every file operation, validation, resolution, the effectful mutation statics and the decode entry. Pure getters, the specifier taxonomy and the format functions are not instrumented. The library stays telemetry-agnostic — applications compose `@effect/opentelemetry` at the edge.

## API Extractor bases

Per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), every Effect class factory is written **inline** with no exported `*_base` const, and the synthesized `_base` heritage symbols are suppressed narrowly in `savvy.build.ts`. Never widen it — an internal type named on a `@public` method signature is a *different* symbol that still forgotten-exports; inline it structurally or mark it `@public`.

The reusable field codecs in `Package.ts` stay `@public`: they are genuine reusable API referenced by the field annotations, so the binary release-tag policy applies to them.

## Testing

`@effect/vitest` with `it.effect` the default mode; shared wiring via top-level `layer(...)` groups, scoped and memoized. Tests in `__test__/` split per concept, integration under `__test__/integration/`.

- **Property tests** cover the specifier taxonomy and name-brand validation; pattern-field checks use lookahead-free regexes so derivation works.
- **Round-trip and wire-transform tests** assert the fidelity contract *structurally* — unknown fields survive read/edit/write, subclasses pull custom fields out of `rest`, empty maps strip and keys land in canonical order — rather than through brittle output snapshots.
- **Integration tests with a real platform filesystem layer are the only tests that provide one**, which is the boundary discipline made explicit.
- **Error-path and behavior-contract tests** cover each read error tag, validation aggregation, structured cause preservation, the dual-signature call styles, `copyWith` completeness, resolution with real versus no-op resolvers and the contract that writing does not mutate contents.
