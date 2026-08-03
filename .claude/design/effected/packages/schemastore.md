---
status: current
module: effected
category: architecture
created: 2026-07-28
updated: 2026-08-02
last-synced: 2026-08-02
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../roadmap.md
  - config-file.md
  - semver.md
---

# @effected/schemastore design

## Overview

`@effected/schemastore` is a reusable way to build, validate, version and publish JSON Schema documents generated from Effect Schema sources, in the shape SchemaStore (schemastore.org) and its consuming toolchain (vscode-json-languageservice, redhat yaml-language-server, taplo, tombi, IntelliJ) expect — plus the catalog-entry and editor/toolchain association artifacts around them. **The package is fully built**: phase 1 (the pure core, commit a74420d02) and phase 2 (the annotation carriers, the `SchemaValidator` seam and `SchemaFile` IO, commit e3430d58) both landed 2026-07-28. `packages/schemastore/CLAUDE.md` is authoritative for the as-built surface; this doc records the design decisions and their rationale.

It generalizes a live consumer implementation: `/Users/spencer/workspaces/savvy-web/silk-release-action/lib/scripts/generate-schema.ts` is the extraction source. A second consumer is expected: the silk-runtime-action greenfield rebuild (its JSON config input schema). The concept previously existed in the retired `config-file-effect` repo as taplo/tombi support for config files; this package is its generic successor. Two named consumers satisfy the kit's scope rule that capability is pulled by real consumers.

## Evidence: what the extraction source does

The silk-release-action script is the working proof of the pipeline, verified against the installed beta:

- Effect Schema source → `Schema.toJsonSchemaDocument` (Draft 2020-12) → `JsonSchema.toDocumentDraft07` — both core effect v4 APIs.
- Assembles the SchemaStore document shape: `$schema` (the draft-07 meta-schema URL) + `$id` + root schema + `$defs` pool.
- Hand-rewrites `#/definitions/...` `$ref` pointers back to `#/$defs/...`, because the Draft-07 lowering emits canonical `#/definitions` refs while the document keeps its pool under `$defs` (a Draft-07-valid alias).
- Validates each produced document with ajv in strict mode (`new Ajv({strict: true, allErrors: true}); ajv.compile(document)`) to catch malformed schema before writing.
- Serializes deterministically and writes-if-changed, logging Written/Unchanged; a drift test imports the pure `build` function directly.
- Multi-target: an array of `{schema, $id, path}` triples.

One wart the package must fix rather than inherit: the script shells out to `pnpm exec biome format` for serialization. A library must own canonical JSON serialization instead of shelling to a formatter.

## Evidence: SchemaStore's contract

From the SchemaStore repo's CONTRIBUTING.md (checkout at `/Users/spencer/workspaces/forks/schemastore`):

- **Dialect.** Draft-07 is recommended; later drafts are explicitly not recommended until IDE/language-server support improves. This validates the script's 2020-12→draft-07 lowering as the correct pipeline, not a legacy accident.
- **Validation.** ajv strict mode is the default and most stringent gate; fixing strict-mode errors does not change validation results, it improves schema quality. Non-strict opt-out goes through the `ajvNotStrictMode` array in `src/schema-validation.jsonc`; SchemaSafe is used additionally (WIP). All schemas must validate against their positive/negative tests using ajv.
- **Layout.** Schema files at `src/schemas/json/<name>.json`; positive tests `src/test/<name>/` and negative tests `src/negative_test/<name>/`, with fixtures in JSON, YAML or TOML; catalog at `src/api/json/catalog.json`.
- **Catalog entry.** `{name, description, fileMatch, url}`; `fileMatch` must avoid generic patterns (the Hugo `config.toml` rejection example) and use simple glob constructs, with alternations expanded into multiple simple patterns. Self-hosted/external schemas register a catalog entry whose `url` points at the externally hosted file.
- **Versioning.** Versioned schemas are separate files suffixed with the version — `agripparc-1.2.json`, `-1.3.json`, `-1.4.json` — plus a `versions` map in the catalog entry (`{"1.2": url, ...}`) with the top-level `url` pointing at the **latest** version. Unversioned schemas are a single plain-named file with `url` only. The package supports both modes.
- **API compatibility rules.** Renaming a schema requires keeping the old file as a `$ref` stub to the new URL; subschema path renames are potentially breaking (tools address subpaths like `#/properties/tool/properties`); refactoring into `$defs`/`definitions` is OK; the `partial-` filename prefix marks extracted subschemas.
- **Authoring best practices** the emitted documents should conform to: avoid overconstraint (no blind `additionalProperties: false`; enum fields should tolerate unknown future values); the description convention `<description>\n<docs-url>`; `UNDOCUMENTED.`/`DEPRECATED.` description prefixes; enums documented as `oneOf` of `{const, description}` rather than editor-specific keys.
- **Non-standard properties** consumed by language servers, relevant because the package should let Effect Schema annotations carry them into emitted documents: `allowTrailingCommas`, `defaultSnippets`, `markdownDescription`, `enumDescriptions`, `markdownEnumDescriptions` (vscode-json-languageservice); `x-taplo`, `x-taplo-info` (taplo); `x-tombi-toml-version`, `x-tombi-array-values-order(-by)`, `x-tombi-table-keys-order`, `x-tombi-string-formats`, `x-tombi-additional-key-label` (tombi); `x-intellij-language-injection`, `x-intellij-html-description`, `x-intellij-enum-metadata` (IntelliJ). Design consideration for the ajv-strict interplay: unknown keywords fail ajv strict mode — SchemaStore handles this via per-schema `options` in `schema-validation.jsonc`, so the package's own lint/validation story must account for the declared non-standard families.
- **Coverage tool.** SchemaStore ships an opt-in coverage tool (8 checks: unused `$defs`, description coverage, test completeness, enum coverage, pattern coverage, required-field coverage, default-value coverage, negative-test isolation), enabled per schema via the `coverage` array in `schema-validation.jsonc`. Candidate inspiration for what the package could lint locally; implementing it is **not** v1 scope.

## Module surface

Module-per-concept per the [module layout standard](../effect-standards.md#module-layout-module-per-concept); no barrel re-exports below the entrypoint.

**Phase 1** — six pure modules: `StoreDocument` (the assembly over core's `Schema.toJsonSchemaDocument` + `JsonSchema.toDocumentDraft07`, owning the `#/definitions`→`#/$defs` ref rewrite and the publication shape — the package owns assembly, **not** a JSON Schema engine), `SchemaTarget` (the target manifest vocabulary: schema + identity + destination path + optional version, generalizing the extraction source's `{schema, $id, path}` triples), `SchemaVersioning` (both catalog modes and the version grammar — see [versioning](#versioning-a-store-native-grammar-not-semver)), `CatalogEntry` (Schema classes for the catalog.json entry shape plus the fileMatch hygiene lint), `DocumentLint` (owned structural checks: `$ref` resolution against the `$defs` pool, unknown keywords outside the declared non-standard families, best-practice advisories) and `CanonicalJson` (the owned deterministic serializer, fixing the extraction source's biome shell-out).

**Phase 2 (commit e3430d58)** — the four remaining modules:

- **`AnnotationCarriers`** — the post-lowering re-graft carrying the non-standard property families (taplo/tombi/vscode/intellij) from Effect Schema annotations into emitted documents — the generic successor to config-file-effect's taplo/tombi support. The mechanism and its rationale are the [annotation carrying](#annotation-carrying-a-parallel-walk-not-pointer-mapping) section below.
- **`KeywordFamilies`** — the one owner of the declared non-standard keyword registry. `AnnotationCarriers`, `StoreDocument` and `DocumentLint` all consume its single predicate, so the carriers and the lint cannot drift apart on what counts as declared.
- **`SchemaValidator`** — the contract seam decided in [the validation seam](#the-validation-seam-the-ajv-question) below, built as designed.
- **`SchemaFile`** — the one IO module, mirroring `@effected/package-json`'s `PackageJsonFile` pattern: write-if-changed over core `FileSystem`/`Path` in `R` (serialization owned by `CanonicalJson`), answering `"written" | "unchanged"` as a value, plus a read side for drift tests. One deliberate divergence from `PackageJsonFile`'s narrowed write channel: `CanonicalJsonError` propagates as itself (its encode is not total, unlike `PackageJsonFile`'s), and a comparison-read failure other than not-found fails typed rather than silently overwriting.

See `packages/schemastore/CLAUDE.md` for the as-built details of every module.

## Annotation carrying: a parallel walk, not pointer mapping

Two probe-established constraints against the installed beta (rung 3 at beta.101) fix the design space. First, core's Draft-07 lowering (`JsonSchema.toDocumentDraft07`) **drops every keyword outside its fixed copy-list** — annotation-admitted keys such as `x-taplo` survive at 2020-12 and vanish after lowering — so the carrier mechanism must act after the lowering; it cannot ride `ToJsonSchemaOptions` alone. Second, the problem was originally framed as mapping schema nodes to JSON-pointer locations in the lowered document — **the probe showed pointer-mapping is the wrong frame entirely.** Annotation-admitted keys land deterministically on their 2020-12 nodes at every attachment site core generates (struct fields, roots, `$defs` entries, tuple members, `optionalKey` wrappers, check-produced `allOf` arms); the definitions pool maps key-for-key through the lowering; the only coordinate move is `prefixItems[i]`→`items[i]` (trailing `items`→`additionalItems`). The mechanism is therefore a **parallel walk mirroring the lowering's descent rules** — no pointer arithmetic exists anywhere in the package.

**Chosen design: option A — ride the 2020-12 generation, re-graft after the ref-rewrite.** Consumers annotate their Effect Schemas where they define them; the carriers copy declared-family keys from each 2020-12 node onto its lowered counterpart. Option B — consumers supply explicit JSON pointers into the lowered document — was rejected: it would discard definition-site DX and force consumers to know the lowered layout, exactly the knowledge this package exists to own.

Two consumer-facing facts the design commits to:

- **Annotate at the definition site.** Annotating a hoisted/identifier'd schema at its *usage* site (e.g. `Person.annotate({...})` inside a struct field) reaches neither the `$ref` node nor the `$defs` pool entry, even at 2020-12 — the annotation silently carries nothing. This is core behavior, documented rather than fixable in this package.
- **Carriers are default-on.** The declared families are always admitted; a caller's `includeAnnotationKey` adds keys but cannot suppress a declared family. A consciously minimal API surface — the flag widens, never narrows.

## Versioning: a store-native grammar, not SemVer

The original proposal said version ordering would come "probably via `@effected/semver`" — but SchemaStore's own catalog labels (e.g. `1.2`) are **not** strict semver and are unparseable by `SemVer.FromString`. The as-built resolution: a store-native `SchemaVersion` grammar `major[.minor[.patch]][-prerelease]` (leading zeros rejected), ordered by padding labels to full SemVer internally via `SemVer.parseResult` + `SemVer.Order`, with labels round-tripping verbatim. `@effected/semver` is a **regular dependency** (`workspace:~`, not a peer) and no `SemVer` type surfaces in the public API. Record for the next consumer: do not assume `SemVer.FromString` accepts a catalog label — it does not.

## The validation seam: the ajv question

SchemaStore's own gate is ajv strict mode, so the package needs a story for real-engine validation. Options:

- **(a) ajv as a runtime dependency** — **rejected.** It makes the package integrated-tier and drags a JSON Schema engine into every consumer's graph, when many consumers only need assembly and lint.
- **(b) a `SchemaValidator` contract seam** — interface + error type only, closed by the consumer with real ajv at the edge. The same contract-seam inversion as `@effected/commands`' `LocalExec` and `@effected/npm`'s resolver contracts.
- **(c) owned structural checking only** — `DocumentLint` in the package, ajv left entirely to consumer CI.

**Decided: (b)+(c), both built.** `DocumentLint` is owned and always available (phase 1); the `SchemaValidator` seam (phase 2) carries real-engine validation without ajv ever entering the dependency graph — the consumer closes it with real ajv at the edge. The seam's channel convention: findings are **values** (an ajv strict-mode compile failure is findings, not an error) and the error channel is reserved for the mechanism itself failing, whose error carries only `cause` — the input may carry no `$id` to name. `validate` takes the flat serialized `Record`, engine-shaped and decoupled from the package's classes. The seam ships `noop` and `makeTest`/`layerTest` so consumers and tests can close it without an engine.

## Tier and dependencies

**Boundary tier as built** (phase 2, as this doc anticipated): all IO lives in `SchemaFile` over core `FileSystem`/`Path` required in `R`; every other module is pure. No third-party runtime dependencies — the package never rises to integrated.

- `peerDependencies`: `effect` (`catalog:effect:peers`).
- `dependencies`: `@effected/semver` (`workspace:~`) — a regular dependency, not a peer, used internally for version ordering in `SchemaVersioning` (see [versioning](#versioning-a-store-native-grammar-not-semver)).
- No `@effected/glob` edge — resolved, see [resolved questions](#resolved-design-questions).
- No ajv, no JSON Schema engine, anywhere in the runtime graph.

## Scope fence: the @effected/json-schema ghost

The repo's CLAUDE.md records that `@effected/json-schema` is off the roadmap entirely — core's `JsonSchema` module made it redundant. This package must stay the narrow publication/catalog/versioning/lint layer and **must not grow into a general JSON Schema package**. Anything that smells like schema construction, ref resolution beyond the document's own `$defs` pool, or dialect conversion belongs to core's `JsonSchema`, not here. This is an explicit non-goal, not a deferral.

## Resolved design questions

- **Module naming**: settled as `StoreDocument`. `SchemaDocument` was rejected because it reads like the banned general-JSON-Schema scope (the [scope fence](#scope-fence-the-effectedjson-schema-ghost)).
- **Annotation mechanism**: fully settled and built — a parallel walk re-grafting after the lowering, with pointer-mapping rejected as the wrong frame entirely (see [annotation carrying](#annotation-carrying-a-parallel-walk-not-pointer-mapping)).
- **`@effected/glob` dependency**: not added. The fileMatch hygiene lint is pattern-shape analysis — it never matches a pattern against a path — so simple structural checks suffice.
- **The `$schema` constant**: keeps the trailing `#` (the SchemaStore corpus convention), deliberately diverging from core's `JsonSchema.META_SCHEMA_URI_DRAFT_07`, which omits it. Documented on the constant.

## Non-goals (v1)

- The SchemaStore coverage tool's 8 checks (candidate inspiration only).
- Generating positive/negative test fixtures.
- Submitting PRs to SchemaStore — the package produces artifacts, humans submit.
- A general JSON Schema package (the scope fence above).
- Formatting of emitted files beyond canonical JSON — presentation formatting is the consumer's concern.

## Status and sequencing

Design-first per the [migration playbook](../migration-playbook.md); this doc was that first step, and **both phases are now implemented** at `packages/schemastore` (phase 1 commit a74420d02, phase 2 commit e3430d58, both 2026-07-28), landing with a zero-warning build. **The package published at `0.1.0` in the 2026-08-03 wave** (wave PR #215, release PR #216 — the wave's one first publish) and the kit-catalog integration is done: it carries its row in [package-inventory.md](../package-inventory.md), its shipped entry in [roadmap.md](../roadmap.md) and its wave record in [releases.md](../releases.md). The outstanding item is the package README, tracked as [effected#218](https://github.com/spencerbeggs/effected/issues/218). No consumer has adopted the published package yet; silk-release-action's `generate-schema.ts` swap and the silk-runtime-action rebuild remain the two named consumers.
