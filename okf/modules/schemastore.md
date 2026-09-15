---
type: Module
title: "@effected/schemastore"
description: Builds, versions, validates and lints SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources, over core's generation pipeline.
status: stable
kind: package
resource: ../../packages/schemastore
layer: L3
tags:
  - architecture
  - bundle
sources:
  - id: package-json
    resource: ../../packages/schemastore/package.json
  - id: claude-md
    resource: ../../packages/schemastore/CLAUDE.md
  - id: claude-modules
    resource: ../../packages/schemastore/CLAUDE.modules.md
  - id: limits
    resource: ../../packages/schemastore/src/internal/limits.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-14T16:39:01Z
  body_sha256: 45df36e84925eb37488acea83030925dbecbf16b35efe219a7c24f4a1f65f676
---

# @effected/schemastore

`@effected/schemastore` builds, validates, versions and publishes JSON
Schema documents generated from Effect Schema sources, in the shape
SchemaStore and its consuming toolchain — vscode-json-languageservice,
redhat's yaml-language-server, taplo, tombi, IntelliJ — expect, plus the
catalog-entry and editor-association artifacts around them.

The division of labour with `effect` core is the package's organizing
idea: core owns the generation pipeline, this package owns the
SchemaStore shape around it. Core's `Schema.toJsonSchemaDocument`
produces Draft 2020-12 and `JsonSchema.toDocumentDraft07` lowers it;
everything this package does is assembly, annotation admission,
versioning, lint, validation and IO on top of that.

## Scope fence

`@effected/json-schema` never existed as a separate package and is off
the roadmap entirely — core's `JsonSchema` module made it redundant.
This package stays the narrow publication, catalog, versioning and lint
layer, and must not grow into a general JSON Schema package: schema
construction, `$ref` resolution beyond the document's own `$defs` pool,
and dialect conversion all belong to core's `JsonSchema`, never here.
This is an explicit non-goal, not a deferral, and the `ajv` dependency
does not widen it — ajv is the validation gate, not a construction or
conversion surface. Also out of scope: generating positive and negative
test fixtures, submitting PRs to SchemaStore (the package produces
artifacts; humans submit), and presentation formatting beyond canonical
JSON.

`packages/schemastore-cli/` on disk holds only `dist/` and
`node_modules/` — build residue with no `package.json` — and is not a
package; do not treat it as one.

## Tier and dependencies: integrated (was boundary)

`ajv` and `ajv-formats` are regular dependencies, and `@effected/semver`
is a regular (not peer) dependency backing version ordering and label
validation — no `SemVer` type surfaces in the public API.[^package-json]
`ajv` is the only third-party runtime dependency and the sole reason the
package is integrated, which is also the guardrail: a second one is a
fresh decision, not a free ride on this one. All IO lives in
`SchemaFile` over core `FileSystem`/`Path` required in `R`; every other
module is pure, so the tier reflects the engine in the graph rather than
leaked IO. There is deliberately no `@effected/glob` edge: the
`fileMatch` hygiene lint is pattern-*shape* analysis and never matches a
pattern against a path, so structural checks suffice.

See [the schemastore retier decision](../decisions/schemastore-retier-to-integrated.md)
for why moving an already-published package's tier was admissible here.

## What SchemaStore's contract requires

Several decisions below look arbitrary in isolation without these
constraints in view:

- **Draft-07 is the dialect** — later drafts are not yet recommended by
  the store, which is what makes the 2020-12 → Draft-07 lowering the
  correct pipeline rather than a legacy accident.
- **ajv strict mode is the gate.** Non-strict is a per-schema opt-out in
  the store's own validation config, so owning the SchemaStore shape
  means having a story for real-engine validation.
- **Versioned schemas are separate files** suffixed with the version,
  plus a version map in the catalog entry whose top-level URL points at
  the latest; unversioned schemas are a single plain-named file.
- **`fileMatch` patterns must avoid generic names** and use simple glob
  constructs, with alternations expanded into multiple simple patterns.
- **Language servers consume non-standard keyword families** — the
  vscode set by exact name, plus the taplo, tombi and IntelliJ prefixes —
  that must ride from Effect Schema annotations into emitted documents
  and interact with the ajv gate, since an unknown keyword fails strict
  mode.

## Module surface

Module-per-concept, no barrel re-exports below the
entrypoint.[^claude-md][^claude-modules] The load-bearing division:

- **`StoreDocument`** — the assembly. Owns the `#/definitions` →
  `#/$defs` `$ref` rewrite the Draft-07 lowering makes necessary, the
  annotation-key admission gate (`UndeclaredAnnotationKeyError`), the
  `rootAnnotations` override merged onto the root after assembly, and
  the publication shape itself. The package owns assembly, not a JSON
  Schema engine.
- **`SchemaTarget`** — the target manifest vocabulary: schema, identity,
  destination path, optional name and version, and two optional
  generation options the pipeline forwards to `StoreDocument.fromSchema`
  so each target states its own generation contract: `jsonSchema`
  (`Schema.ToJsonSchemaOptions`) and `rootAnnotations`.
- **`SchemaVersioning`** — both catalog modes and the version grammar,
  plus `isPinned` and `next`; see [Versioning](#versioning-schemastores-file-convention-semvers-label-grammar).
- **`CatalogEntry`** — the catalog entry shape plus the `fileMatch`
  hygiene lint.
- **`DocumentLint`** — owned structural checks: `$ref` resolution
  against the `$defs` pool, unknown keywords outside the declared
  families, best-practice advisories, and a depth cap that degrades to a
  finding rather than throwing.
- **`CanonicalJson`** — the owned deterministic serializer. A library
  must own canonical JSON rather than shelling out to a formatter
  binary; it fails typed on values `JSON.stringify` would silently drop
  or rewrite. It also exports `equals(left, right)`, parsed-content
  equality under the serializer's own semantics — object key order
  ignored, array order significant, `NaN` never equal, total past a
  stack guard — so `DocumentDiff`, `SchemaFile` and a consumer writing
  its own JSON artifact (the CLI's catalog entries) decide "unchanged"
  by one rule.
- **`KeywordFamilies`** — the one owner of the declared non-standard
  keyword registry, in two groups: the upstream language-server families
  and the house `x-ai-` machine-annotation namespace. The assembly, the
  lint and the validator all consume its single predicate, so they
  cannot drift on what counts as declared.
- **`SchemaValidator`** — real-engine validation; see
  [the validation gate](#the-validation-gate-ajv-ships-closed).
- **`DocumentDiff`** — pure change classification; see
  [change classification](#change-classification-annotations-versus-contract).
- **`SchemaFile`** — the one IO module; see
  [write-if-changed](#write-if-changed-compares-content-not-bytes).
- **`SchemaPipeline`** — the emit verb, carrying the contract policy
  (`ContractChangePolicy`, `SchemaContractChangeError`); see
  [the pipeline](#the-pipeline-orchestration-as-a-shipped-surface).
- **`DriftPolicy`** — the pure drift classifier over a published
  target's `WriteChange`; see [the CLI contract](#the-cli-contract-defineconfig-drift-and-published).
- **`SchemastoreConfig`** — `defineConfig`, the keyed `schemastore.config.ts`
  contract; see [the CLI contract](#the-cli-contract-defineconfig-drift-and-published).

There is no annotation-carrier module. `AnnotationCarriers` existed to
re-graft declared keys after the Draft-07 lowering dropped them; core
stopped dropping them and the module was deleted, along with its
`CarrierDepthExceededError`. Admission is now `StoreDocument`'s own
gate.

## Annotation carrying: core carries the keywords, the package owns admission

Effect rc.112 (Effect-TS/effect#7420, "Make JSON Schema dialect
conversions preserve custom keywords") made `JsonSchema.toDocumentDraft07`
copy unknown and custom keywords through as opaque values, in place,
including across the coordinate moves the lowering performs — 2020-12
`prefixItems[i]` → Draft-07 `items[i]`, and a trailing `items` schema →
`additionalItems`. This falsified the predecessor design's premise, which
held that the lowering dropped every keyword outside its fixed
copy-list; that premise was true of the prereleases it was probed
against. `AnnotationCarriers`, a parallel walk mirroring the lowering's
descent rules, existed solely to put the dropped keys back afterwards.
Re-probed at rc.112, the re-graft proved redundant in every required
case (field node, root node, a `$defs` pool entry reached through
`suspend`, the tuple-item move, the rest-element move, and an annotation
landing in an `allOf` position beside a check). The module was deleted;
the probes are permanent tests in `__test__/annotation-carrying.test.ts`,
asserting directly on raw `JsonSchema.toDocumentDraft07` output so a
regression in core is attributed to core rather than rediscovered as a
package bug.

What the deletion moved rather than removed is **admission**. The
package previously relied on the lowering's drop as its enforcement — a
caller-supplied `includeAnnotationKey` could admit any key it liked, and
anything outside the declared families quietly vanished during
lowering. Core's fix exposed that reliance by shipping those keys
straight into the emitted document. The gate is now the package's own:
`StoreDocument.fromSchema` / `fromSchemaResult` fail with the `@public`
typed `UndeclaredAnnotationKeyError` (carrying the document's `$id` and
the sorted offending `keys`) when the caller's predicate admits a key
outside the declared families. Failing loudly beats both alternatives:
emitting the key ships a document SchemaStore's own ajv-strict gate
rejects, and silently omitting it hides the mistake in the caller's
predicate.

Three consumer-facing facts:

- **Annotate at the definition site.** Annotating a hoisted or
  identifier'd schema at its *usage* site reaches neither the `$ref`
  node nor the `$defs` pool entry, even at 2020-12 — the annotation
  silently carries nothing.
- **The declared families are default-on and cannot be turned off.**
  They are admitted regardless of what a supplied `includeAnnotationKey`
  answers; the predicate's only remaining role is admitting a key that
  fails the build.
- **Carried values are shared by reference, not cloned.** A declared
  key's value in the emitted document is the same object the caller
  handed to `.annotate()`; mutating a carried `x-ai-hint` payload in
  place corrupts every later emission from that schema, not merely this
  document.

The `#/definitions` → `#/$defs` rewrite deliberately does not descend
into a declared-family value: those payloads are opaque advice to a
language server, and a `$ref`-shaped string inside one means whatever
that tool says it means.

A `Schema.Class` root must be annotated on the `Struct` it wraps, never
on the class — class-argument or class-level `.annotate()` keys sit on
the class node, but core generates the `$defs` entry from the *encoded*
fields `Struct`, so title, description and the declared families vanish
unless annotated on that inner struct. This is by design, not a core
bug (Effect-TS/effect#8084, closed as such), and the inner-Struct rule
stands; the `rootAnnotations` override below is its complement, not a
replacement.

`StoreDocumentOptions.rootAnnotations` (and `SchemaTarget.rootAnnotations`,
which `SchemaPipeline` forwards) is the escape hatch for a generator-side
annotation loss the source schema cannot express — a filtered field, or
a root whose annotations core does not carry. The map is merged onto the
emitted root after assembly, override keys winning over generated ones
and `undefined` values skipped rather than written. Admission is gated
up front, before anything is generated: a key must be one of the
standard annotation keywords (`title`, `description`, `$comment`,
`default`, `examples`, `readOnly`, `writeOnly`) or fall in a declared
keyword family, and anything else fails `UndeclaredAnnotationKeyError`
naming the override keys — so when both this gate and the
`includeAnnotationKey` gate would fire, the override's keys are the ones
reported, and the override can never smuggle in an assertion keyword.
Placement follows Draft-07's rule that validators ignore `$ref`
siblings: when the assembled root is exactly a bare local `$ref`
(`{ "$ref": "#/$defs/X" }`, the shape a `Schema.Class` root produces),
the merge lands on the `$defs` entry the pointer names — decoded through
core's `JsonPointer.parseUriFragment`, so a pointer-escaped or
percent-encoded name resolves — rather than on a root that would carry
the keys nowhere. Override values are shared by reference exactly like
`.annotate()` payloads, and the `$ref` rewrite never walks them.

## Versioning: SchemaStore's file convention, SemVer's label grammar

The file-name convention stays the store's: `<name>-<version>.json`,
hyphen-separated, matching its guide and its corpus.

The label grammar accepts one to three components — `major`,
`major.minor` or `major.minor.patch`, with an optional prerelease —
matched by a grammar regex first and then checked through
`@effected/semver`'s own parse over the label padded to three components:
the regex admits the shape, the parse settles validity and rejects build
metadata. The store's own labels
are commonly two-part, and a config author writing `okfit-1.2.json`
should not have to spell `1.2.0`; a missing component reads as `0` for
ordering, so `1`, `1.0` and `1.0.0` compare equal while each label
round-trips verbatim into its file name. `defineConfig` refuses two
spellings of one version under one name for exactly that reason. Build
metadata is rejected (SemVer precedence ignores it, so two labels
differing only in build would both claim to be latest), and surrounding
whitespace is rejected since the underlying parse trims and an
untrimmed label would round-trip verbatim into a file name.

`isPinned` is the one predicate the contract guard and the version bump
both read, because they must never disagree: a label with no
prerelease is "pinned" — a published, URL-pinned document — and both
`SchemaPipeline`'s `"block-versioned"` policy and `SchemaVersioning.next`
consume the exact same test. `next(current, change)` is pure and total
with three arms: any non-`"contract"` classification is identity; a
non-pinned (prerelease) `current` is identity; otherwise a MINOR bump
that preserves the label's component count (`1` → `2`, major being
the only axis a one-component label has; `1.2` → `1.3`; `1.2.3` →
`1.3.0`). It is a suggestion the CLI surfaces, not a
verdict — the drift policy decides whether a published document may
change at all — so the bump's job is to be strictly greater and
conspicuous, not to encode SemVer compatibility: `DocumentDiff` cannot
distinguish an added optional property from a removed required one, so
every contract change reads as breaking regardless of whether it
actually is.

## The CLI contract: defineConfig, drift and published

The `schemastore-cli` companion consumes three additions that stay in
this library so any caller can reason with them. `SchemaTarget.published`
(always present, default `false`) is the lifecycle switch: an
unpublished target is regenerated in place until someone depends on its
label, a published one is held to a drift tolerance. `DriftPolicy`
is the pure classifier over that switch — `classify({published,
change}, policy)` answers `"write"` or `"drift"`, with `"semantic"` (only
a `"contract"` change is drift) as the default, `"strict"` holding
annotation changes too and `"allow"` holding nothing; `DriftPolicy.defaults`
is `{ policy: "semantic", onDrift: "error" }`.

`defineConfig` is the `schemastore.config.ts` contract, pure and IO-free,
keyed by schema name:

```ts
import { defineConfig } from "@effected/schemastore";
import { OkfitConfig } from "./src/config-schema.js";

export default defineConfig({
  outputDir: "schemas",
  baseUrl: "schemastore",
  schemas: {
    okfit: {
      schema: OkfitConfig,
      versions: ["1.0"],
      published: true,
      catalog: { description: "okfit configuration", fileMatch: ["okfit.toml", ".okfit.toml"] },
    },
  },
});
```

A first-run config declares a single label; a second label is appended to
`versions` only once the first is published and its file already exists on
disk — see `schemastore-cli.md`'s drift table and the
`building-schemastore-schemas` skill's `drift-and-versioning.md` reference
for the lifecycle.

Self-hosted, the same entry takes
`baseUrl: "https://raw.githubusercontent.com/o/r/main/schemas"` and derives
`schemas/1.1/okfit-1.1.json` (the `"versioned"` layout) instead of the flat
SchemaStore file.

The record key IS the schema's `name` — every derived `path`, `$id` and
catalog URL is built from it, so it must satisfy the existing simple-name
rule (non-empty, no separators, no whitespace). **Identity is derived, never
cross-checked: `$id`, the file path and every catalog URL come from one
`relativeFile(name, version, layout)`; there is no `$id` override by
design (#715)** — `layout` covers the one known divergence, and an override
would reopen exactly the disagreement #715 is about. `versions` lists every
label the catalog advertises; exactly one of them, `current` (default: the
highest under `SchemaVersioning.Order`), is generated from `schema`, and the
rest become **frozen** `FrozenVersion` entries — files that already exist on
disk, advertised by the catalog and verified on disk by the CLI, never
regenerated. `outputDir` is top-level only, one destination per config;
`baseUrl` and `drift` are top-level defaults an entry may override; `onDrift`
is run-wide and not overridable. `catalog` is opt-in on any host but
**required** under `baseUrl: "schemastore"` — hosting there means being in
its catalog — and `layout` is only meaningful for a custom URL, an error
under `"schemastore"`, which serves one flat shape.

`baseUrl: "schemastore"` means two hosts, a verified fact and not a guess:
hosted documents carry `$id: https://json.schemastore.org/<file>` while
`catalog.json` points `url` at `https://www.schemastore.org/<file>`
(checked against `clangd.json` and `agripparc-1.4.json` on 2026-09-14). A
custom `baseUrl` is one base for both `$id` and the catalog URL instead.

`defineConfig` validates the whole input and throws a plain `Error`
prefixed `defineConfig:` naming the offending schema — never a raw
`TypeError` — on an empty `schemas` record or a missing/empty `outputDir`;
a key that fails the simple-name rule; an empty `versions` array or a label
that fails to parse or duplicates another under
`SchemaVersioning.Order`; `current` given without `versions`, or naming one
not among them; `layout` under `"schemastore"`; a missing `catalog` under
`"schemastore"`, or one with an empty `fileMatch`; an invalid `drift` or
top-level `onDrift`; and an output path (a target, a frozen file or the
catalog path) declared twice, compared after lexical normalisation. The CLI
wraps the throw into its typed load error (exit `2`). The result is branded
with a private symbol so `isSchemastoreConfig` recognises a loaded module's
default export without the loader inspecting its shape.

`SchemaTarget.make` survives unchanged as the library-level primitive for a
caller driving `SchemaPipeline` directly; `defineConfig` lowers each entry
onto it. The old array-of-targets `SchemastoreConfigInput` and its
per-target catalog/entry-pair types no longer exist. Together with the
widened version grammar above, this is the whole surface the CLI needs
from the library.

## The validation gate: ajv ships closed

See [ajv ships closed](../decisions/schemastore-ajv-ships-closed.md) for
the full reasoning and the alternatives it overturned. The shipped layer
registers every declared keyword family found in the document before
compiling, so ajv strict mode cannot reject the language-server families
the lint deliberately allows — one predicate governs both verdicts. For
the same reason it registers the standard `ajv-formats` vocabulary, and
only the vocabulary (`addFormats(ajv, { keywords: false })`): without
it, strict mode rejects every document using `format` at all, so a
consumer could not express "this string is an ISO-8601 instant" in a
published document. An unknown format string is still a strict-mode
rejection, and the plugin's `keywords` option stays off, because
enabling it would also register `formatMaximum`/`formatMinimum` and
their exclusive variants, which `DocumentLint` answers as unknown
keywords — exactly the two-verdicts drift the declared-families rule
exists to prevent.

## Write-if-changed compares content, not bytes

See [write-if-changed compares content](../decisions/schemastore-write-if-changed-compares-content.md).
`outcome`/`wouldWrite` are the authoritative "was/would the file be
touched" answers — never infer it from `change`, which reads `"none"`
on a `compare: "bytes"` write. `write` and `check` share one internal
comparison helper so the two routes cannot disagree, and `check` never
writes, since a CI drift job must not regenerate. An existing file that
does not parse is classified as a contract change and repaired, not
failed typed — failing would leave a hand-corrupted generated file
permanently un-regenerable.

## Change classification: annotations versus contract

If the writer parses both sides anyway, it can say what kind of change
it found: none, annotations-only, or contract. The governing principle:
a keyword is a CONTRACT change when it alters what a validator asserts
or what data a generic tool writes into an instance; a keyword that
alters only the advice given to a reader — human or machine — is an
ANNOTATION. That test puts `default`/`examples`/`readOnly`/`writeOnly`
on the contract side despite Draft-07's own taxonomy calling them
annotations (a generic tool acts on them), and puts `x-ai-*` on the
annotation side despite it being a family this package itself declared
(it advises a machine reader and asserts nothing). Adopting `x-ai-*` on
an already-published, versioned document rewrites that file in place
rather than cutting a new version, because the change classifies as
`"annotations"` — that is correct, not a gap, since the annotation is
transparently replaceable by definition. The asymmetry is deliberate:
misreporting a contract change as annotations ships a silent breaking
change, while the reverse costs only an unnecessary version bump.

The leaf value comparison is `CanonicalJson.equals`, whose stack guard
(`MAX_NESTING_DEPTH * 8`, owned by `CanonicalJson`, not `DocumentDiff`)
is deliberately looser than the structural depth cap
(`MAX_NESTING_DEPTH = 256`);[^limits] sharing one budget was a real
bug, since the structural walk stopped classifying at the cap and
handed the remainder to a comparison that then ran out of frames before
reaching the leaves, comparing a deeply-nested but identical document as
different.

## The pipeline: orchestration as a shipped surface

The generate → lint → validate → gate → write loop is shipped because
every consumer was writing it independently and would diverge on error
shape, log wording and — most consequentially — gating policy. It adds
no JSON Schema capability at all, only orchestration over modules
already owned.

`SchemaPipeline` is plain statics, not a `Context.Service` — its
requirements compose through `R` for free, and a service would add a
layer to wire for no capability the consumer lacks. Gating is policy and
must be overridable: the default treats warnings as blocking, which is
right, but a hardcoded policy would send anyone who disagrees back to
hand-rolling the whole loop. Findings are values, never logs.

Know which gate actually blocks: a pipeline document is always built
through the generation path, and `StoreDocument.fromSchema` refuses an
undeclared annotation key outright, failing `UndeclaredAnnotationKeyError`
before a document exists to lint — so the unknown-keyword check cannot
fire through the pipeline at all, and the **engine** gate is what stops
a bad document on a schema-derived target. The lint's warning checks
earn their keep on documents the pipeline did not build (a hand-assembled
document, or one read back off disk) and on depth, which a schema can
genuinely exceed.

`run` is two-phase and writes nothing unless every target passes. Phase
1 touches no filesystem: it generates each target's document, runs the
gate (fail-fast on `SchemaGateError`), and, only for a target the
contract policy guards, classifies it against its on-disk predecessor.
Phase 2 writes the held documents, in target order, only once every
target has cleared phase 1. `check` stays total over the targets and
never fails on findings, carrying `blocked` and `contractBlocked` per
target instead.

`contractChanges` is the second, independent policy, keyed on
`SchemaVersioning.isPinned(target.version)`. The default,
`"block-versioned"`, treats a pinned versioned target as a published,
URL-pinned document: a `"contract"` classification against it fails with
`SchemaContractChangeError`, collected across every guarded target
before the error is raised. An unversioned target, or one carrying a
prerelease label, has no such consumer expectation and is rewritten in
place exactly as before. `"allow"` is the escape hatch — classify and
report only — and it is also the sanctioned repair path for a corrupted
published file. The policy is only coherent when the version
participates in `path` (`schemas/<version>/<name>-<version>.json`); a
versioned target whose path does not embed the label compares the same
file forever regardless of what `version` says.

## Testing and build

Tests live in `__test__/` (`@effect/vitest`, `assert.*` — never
`expect`); `SchemaFile`'s real-IO tests are under `integration/`, using
`@effect/platform-node` as a devDependency for the differential
integration test.[^package-json] The version-label grammar is pinned by
property tests (`it.prop` over generated one-to-three-component labels):
every label parses and round-trips verbatim, and `Order` is invariant
under zero-padding to three components. `savvy.build.ts` carries the narrow
`{ messageId: "ae-forgotten-export", pattern: "_base" }` suppression for
the heritage symbols, and `SchemaTarget`'s class/interface merge carries
a house `biome-ignore lint/suspicious/noUnsafeDeclarationMerging` under
the statics-only justification recorded in
[no barrel re-exports](../conventions/no-barrel-re-exports.md#a-sanctioned-grouped-statics-container-is-a-class-not-an-as-const-object).

[^package-json]: `packages/schemastore/package.json` — `ajv`,
    `ajv-formats` and `@effected/semver` as regular dependencies;
    `@effect/platform-node` as a devDependency.
[^claude-md]: `packages/schemastore/CLAUDE.md` — tier, scope fence, and
    the rules index.
[^claude-modules]: `packages/schemastore/CLAUDE.modules.md` — per-module
    surface listing.
[^limits]: `packages/schemastore/src/internal/limits.ts:11` —
    `MAX_NESTING_DEPTH = 256`.
