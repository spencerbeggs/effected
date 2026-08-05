---
status: current
module: effected
category: architecture
created: 2026-07-28
updated: 2026-08-04
last-synced: 2026-08-04
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

**Phase 1** — six pure modules: `StoreDocument` (the assembly over core's `Schema.toJsonSchemaDocument` + `JsonSchema.toDocumentDraft07`, owning the `#/definitions`→`#/$defs` ref rewrite and the publication shape — the package owns assembly, **not** a JSON Schema engine), `SchemaTarget` (the target manifest vocabulary: schema + identity + destination path + optional version, generalizing the extraction source's `{schema, $id, path}` triples), `SchemaVersioning` (both catalog modes and the version grammar — see [versioning](#versioning-schemastores-file-convention-semvers-label-grammar)), `CatalogEntry` (Schema classes for the catalog.json entry shape plus the fileMatch hygiene lint), `DocumentLint` (owned structural checks: `$ref` resolution against the `$defs` pool, unknown keywords outside the declared non-standard families, best-practice advisories) and `CanonicalJson` (the owned deterministic serializer, fixing the extraction source's biome shell-out).

**Phase 2 (commit e3430d58)** — the four remaining modules:

- **`AnnotationCarriers`** — the post-lowering re-graft carrying the non-standard property families (taplo/tombi/vscode/intellij) from Effect Schema annotations into emitted documents — the generic successor to config-file-effect's taplo/tombi support. The mechanism and its rationale are the [annotation carrying](#annotation-carrying-a-parallel-walk-not-pointer-mapping) section below.
- **`KeywordFamilies`** — the one owner of the declared non-standard keyword registry. `AnnotationCarriers`, `StoreDocument` and `DocumentLint` all consume its single predicate, so the carriers and the lint cannot drift apart on what counts as declared.
- **`SchemaValidator`** — the contract seam decided in [the validation seam](#the-validation-seam-the-ajv-question) below, built as designed.
- **`DocumentDiff`** — pure change classification between two documents, added 2026-08-04; see [change classification](#change-classification-annotations-versus-contract). `SchemaFile` and `SchemaPipeline` both report its verdict, so the writer and the drift check answer the same question.
- **`SchemaPipeline`** — the emit verb over a `SchemaTarget` manifest (`run` / `check`), added 2026-08-04; see [the pipeline](#the-pipeline-orchestration-as-a-shipped-surface).
- **`SchemaFile`** — the one IO module, mirroring `@effected/package-json`'s `PackageJsonFile` pattern: write-if-changed over core `FileSystem`/`Path` in `R` (serialization owned by `CanonicalJson`), answering `{outcome, change}` as a value, plus `read` (exact text) and `check` (the non-writing drift half). **The comparison is by content, not bytes, since 2026-08-04** — see [the comparison question](#write-if-changed-bytes-or-content). One deliberate divergence from `PackageJsonFile`'s narrowed write channel: `CanonicalJsonError` propagates as itself (its encode is not total, unlike `PackageJsonFile`'s), and a comparison-read failure other than not-found fails typed rather than silently overwriting.

See `packages/schemastore/CLAUDE.md` for the as-built details of every module.

## Annotation carrying: a parallel walk, not pointer mapping

Two probe-established constraints against the installed beta (rung 3 at beta.101) fix the design space. First, core's Draft-07 lowering (`JsonSchema.toDocumentDraft07`) **drops every keyword outside its fixed copy-list** — annotation-admitted keys such as `x-taplo` survive at 2020-12 and vanish after lowering — so the carrier mechanism must act after the lowering; it cannot ride `ToJsonSchemaOptions` alone. Second, the problem was originally framed as mapping schema nodes to JSON-pointer locations in the lowered document — **the probe showed pointer-mapping is the wrong frame entirely.** Annotation-admitted keys land deterministically on their 2020-12 nodes at every attachment site core generates (struct fields, roots, `$defs` entries, tuple members, `optionalKey` wrappers, check-produced `allOf` arms); the definitions pool maps key-for-key through the lowering; the only coordinate move is `prefixItems[i]`→`items[i]` (trailing `items`→`additionalItems`). The mechanism is therefore a **parallel walk mirroring the lowering's descent rules** — no pointer arithmetic exists anywhere in the package.

**Chosen design: option A — ride the 2020-12 generation, re-graft after the ref-rewrite.** Consumers annotate their Effect Schemas where they define them; the carriers copy declared-family keys from each 2020-12 node onto its lowered counterpart. Option B — consumers supply explicit JSON pointers into the lowered document — was rejected: it would discard definition-site DX and force consumers to know the lowered layout, exactly the knowledge this package exists to own.

Two consumer-facing facts the design commits to:

- **Annotate at the definition site.** Annotating a hoisted/identifier'd schema at its *usage* site (e.g. `Person.annotate({...})` inside a struct field) reaches neither the `$ref` node nor the `$defs` pool entry, even at 2020-12 — the annotation silently carries nothing. This is core behavior, documented rather than fixable in this package.
- **Carriers are default-on.** The declared families are always admitted; a caller's `includeAnnotationKey` adds keys but cannot suppress a declared family. A consciously minimal API surface — the flag widens, never narrows.

## Versioning: SchemaStore's file convention, SemVer's label grammar

The original proposal said version ordering would come "probably via `@effected/semver`". The first build rejected that, because SchemaStore's own catalog labels (e.g. `1.2`) are **not** strict semver and are unparseable by `SemVer.FromString`, and shipped a store-native grammar `major[.minor[.patch]][-prerelease]` ordered by padding labels to full SemVer internally.

**Revised 2026-08-04 (`0.2.0`), by owner decision: labels are full three-component SemVer, enforced by `@effected/semver` itself.** The two halves of "follow SchemaStore" pull apart here and are now decided separately:

- **The file-name convention stays the store's**: `<name>-<version>.json`, hyphen-separated, per its CONTRIBUTING guide and the `agripparc-1.2.json` corpus. An earlier draft of this change flipped the separator to a dot for easier URL parsing; that was withdrawn — the separator is the store's convention and there is no reason to diverge on it.
- **The label grammar narrows to SemVer.** A partial label cannot be split back out of a file name or URL unambiguously, which is the operation a consumer of these artifacts actually performs. Requiring `major.minor.patch` makes it mechanical.

The cost, stated plainly: a schema submitted to SchemaStore proper carries a third component its neighbours lack (`agripparc-1.2.0.json` beside `agripparc-1.2.json`). Valid, and the store prescribes no label grammar — just not identical in style. For self-hosted schemas, where the URL is the publisher's own, there is no cost at all.

Three consequences worth recording:

- **Build metadata (`+build`) is rejected**, as the old grammar also did: it is hostile in a URL, and SemVer precedence *ignores* it, so two labels differing only in build compare EQUAL and both would claim to be the latest version.
- **The ordering pad is gone.** A validated label is already a SemVer string, so `Order` is a plain parse — and the brand's filter and `Order`'s parse are now literally the same call, which retires a whole class of drift (the recorded `1.2-01` regression was exactly the grammar admitting something the pad could not parse).
- **The `versions` map's JS-object caveat is retired.** The old grammar allowed a bare-major label (`"2"`), which is array-index-like, so JavaScript enumerated it ahead of every dotted key regardless of insertion order and the docs had to warn that key position was not the ordering contract. No SemVer label is integer-like, so ascending insertion order now survives serialization.

`@effected/semver` remains a **regular dependency** (`workspace:~`, not a peer). It now backs validation as well as ordering, but no `SemVer` type surfaces in the public API — `SchemaVersion` is still a branded string.

## The validation seam: the ajv question

SchemaStore's own gate is ajv strict mode, so the package needs a story for real-engine validation. Options:

- **(a) ajv as a runtime dependency** — **rejected.** It makes the package integrated-tier and drags a JSON Schema engine into every consumer's graph, when many consumers only need assembly and lint.
- **(b) a `SchemaValidator` contract seam** — interface + error type only, closed by the consumer with real ajv at the edge. The same contract-seam inversion as `@effected/commands`' `LocalExec` and `@effected/npm`'s resolver contracts.
- **(c) owned structural checking only** — `DocumentLint` in the package, ajv left entirely to consumer CI.

**Originally decided: (b)+(c), both built.** `DocumentLint` is owned and always available (phase 1); the `SchemaValidator` seam (phase 2) carried real-engine validation without ajv entering the dependency graph.

**REVERSED 2026-08-04 — (a) adopted, by owner decision.** The first external adoption (`claude-code-marketplace-manager`, dogfood round 1 item 3) supplied the evidence and the repo owner made the call: **ajv is now a direct runtime dependency and `SchemaValidator.layer` ships a real implementation.** The reasoning, recorded because it overturns the rejection above:

- The premise behind (a)'s rejection — "many consumers only need assembly and lint" — did not survive contact. This package is **build-time tooling installed as a devDependency**; the engine's weight in a consumer's runtime graph is a cost that was never actually paid by anyone.
- ajv is not an incidental implementation choice but **a first-class part of SchemaStore's own contract**: the gate IS ajv strict mode ([the corpus survey](#evidence-schemastores-contract)). A package that owns the SchemaStore shape while refusing to own its gate is drawing the boundary in the wrong place.
- The seam's cost was real and recurring: every consumer wrote the same adapter, and the adopting consumer wrote it *worse* — collapsing all of ajv's structured errors into a single `ValidationFinding` with `path: ""`, which wasted the finding vocabulary and made `allErrors: true` inert. Shipping the mapping once, correctly, is strictly better than three consumers converging on a lossy version of it. **An example copied verbatim out of a README is a default that has not been shipped.**
- The middle path (a companion `@effected/schemastore-ajv` package) was available and declined: it preserves the ceremony while adding a package to maintain.

What survives the reversal: the **channel convention** (findings are values — a strict-mode rejection is a report, not an error; the error channel is the mechanism failing, carrying only `cause` since the input may have no `$id` to name), the **engine-shaped input** (`validate` takes the flat serialized `Record`, decoupled from the package's classes), and the **service-as-interface** — `noop`, `makeTest`/`layerTest` and a substitutable engine all remain. What changed is only that not-writing-an-adapter is now the default path rather than an impossibility.

The shipped layer registers every declared `KeywordFamilies` keyword found in the document before compiling, so ajv strict mode cannot reject the language-server families `DocumentLint` deliberately allows — one predicate governs both verdicts, extending the anti-drift property the registry already had.

## Write-if-changed: bytes or content

The phase-2 `write` compared the serialized text against the file's exact bytes. The first external adoption falsified the docstring promise that "a generator committed to a repo does not churn mtimes" (effected#262, dogfood round 1 item 1): the adopting repo's pre-commit hook runs Biome over staged JSON, Biome collapses short arrays that `CanonicalJson` puts one-per-line, and so every run read back reformatted bytes, found them different, and rewrote — forever. `"unchanged"` was unreachable and a CI drift check failed on a document whose content never changed. **A repo that formats its JSON is the common case, not the exotic one**, and the only consumer-side fix was a formatter carve-out caused entirely by the comparison's layer.

**Decided: compare parsed content by default, with `compare?: "bytes" | "value"` (default `"value"`) as the opt-out.** Content equality is what `"unchanged"` was always trying to express, and it is immune to any downstream formatter. Object key order is not a difference (a formatter may sort); array order is (that is data).

Two consequences worth stating, because they are not obvious:

- **`read` alone stopped being a sufficient drift check.** With value comparison, `write` legitimately leaves a formatter's bytes on disk, so a text-comparing drift test disagrees with the writer — the exact confusion the report described, just moved to the other half of the pair. Hence **`check`**: the same comparison without touching the filesystem, which is what a CI drift job actually wants (it must not regenerate). `check` answers `{wouldWrite, change}` — `change` is the content question (format-immune) and `wouldWrite` honors `compare`, so the pair agrees with the writer under either mode. Both routes compute from **one** internal `compare` helper, so they cannot drift apart. (Shipped first answering only `change`; the adopting consumer confirmed within minutes that under `compare: "bytes"` nothing answered "would `write` act", so `wouldWrite` was added before release.)
- **An existing file that does not parse is classified `"contract"` and repaired**, not failed typed. Failing would leave a hand-corrupted generated file permanently un-regenerable, which is worse than overwriting something that was not a valid document in the first place.

## Change classification: annotations versus contract

Adopting content comparison raised a better question than the one asked: if the writer is going to parse both sides anyway, it can say *what kind* of change it found. `DocumentDiff` classifies two documents as `"none"`, `"annotations"` or `"contract"`.

The value is versioning. Under `SchemaVersioning`, the decision "does this change need a new schema version" is exactly the question of whether a document valid against the old schema is still valid against the new one. **Rewording a description is transparently replaceable; moving an assertion keyword is not.** A generator that reports the difference gives its operator that signal for free, at the moment it matters.

Two design calls, both deliberately conservative:

- **`default`, `examples`, `readOnly` and `writeOnly` are NOT treated as documentation**, though the Draft-07 vocabulary's own taxonomy calls them annotations — form generators and clients act on them. The asymmetry is intentional: misreporting a contract change as `"annotations"` ships a silent breaking change, while the reverse costs only an unnecessary version bump. When in doubt the documentation set stays small.
- **The walk is keyword-position aware**, mirroring `DocumentLint`'s descent exactly: a property *named* `description` inside `properties` is data, not an annotation. This is the same class of mutant the lint suite already pins.

The leaf value comparison uses a looser stack guard than the structural `MAX_NESTING_DEPTH` cap. Sharing one budget was a real bug caught in test: the structural walk stopped classifying at 256 and handed the remainder to a comparison that then ran out of frames before reaching the leaves, so a deeply-nested but *identical* document compared as different. The two are different concerns — one bounds how deep meaning is assigned, the other only prevents a stack overflow.

## The pipeline: orchestration as a shipped surface

Round 2 of the same dogfood loop reported that after adopting the round-1 changes, the consumer's generator was 127 lines of which ~45 were repo-specific and the rest was the same generate → lint → validate → gate → write loop every consumer writes. Three consumers existed by then (the silk-release-action extraction source, the silk-runtime-action rebuild, and `claude-code-marketplace-manager`), each having written that loop independently — so they would diverge on error shape, log wording and, most consequentially, **gating policy**.

**Decided: ship it, as `SchemaPipeline`.** The argument that settled it is that this is the ajv reversal one layer up: there the copied boilerplate was the engine adapter and shipping it once fixed a bug none of the copies had noticed; here the boilerplate is the loop, and the latent divergence is two consumers disagreeing about what `advisory` means.

It does not cross the [scope fence](#scope-fence-the-effectedjson-schema-ghost): it adds no JSON Schema capability at all, only orchestration over modules already owned, in the order the package already documents.

Three design calls:

- **A plain function, not a `Context.Service`.** It needs `SchemaFile | SchemaValidator`, which compose through `R` for free; a service would add a layer to wire for no capability the consumer lacks — precisely the ceremony the ajv reversal removed one section above.
- **Gating is policy and must be overridable.** The default is `severity === "warning"`, which is right (`UnresolvedRef`, `UnknownKeyword` and `DepthExceeded` each describe a document broken for the editors it serves, and `UnknownKeyword` is by construction the ajv-strict rejection set, so tolerating it ships something the second gate rejects). But a hardcoded policy sends anyone who disagrees back to hand-rolling the whole loop to change one comparison, which defeats the point of shipping it.
- **Findings are values, never logs**, consistent with `DocumentLint`'s existing convention. This deliberately does NOT solve the reported log-wording divergence — log wording is repo policy and the package should not own it. What it solves is the gating divergence, which is the part that silently changes what ships.

Both gates' findings normalize into one `PipelineFinding` so a single predicate judges them; engine findings are always `"warning"` because a document the engine rejects is not advisory.

**Through this entry point, the engine gate is what actually blocks.** A `SchemaTarget` carries a `Schema`, so a pipeline document is always built by `StoreDocument.fromSchema` — and the Draft-07 lowering drops every keyword outside its copy-list, so an undeclared keyword never survives to be linted. `UnknownKeyword` therefore **cannot fire through the pipeline at all**: probed against the built artifact, a schema annotated with undeclared `x-` keys emits a document carrying none of them while the declared `markdownDescription` survives via the carriers, and `DocumentLint.lint` returns nothing. (Reported by the first pipeline adopter in dogfood round 3 as an observation, then confirmed here; pinned by a test in `__test__/schema-pipeline.test.ts`.)

The default `blocking` predicate is unchanged and still correct — this is a reachability fact, not a policy error. What it corrects is a **claim**: the lint's warning checks earn their keep on documents the pipeline did *not* build — a hand-assembled `StoreDocument.draft07`, or one read back off disk — and on `DepthExceeded`, which a schema can genuinely exceed. Do not describe the pipeline's lint gate as the thing catching keyword mistakes on schema-derived documents; the gating argument [above](#the-pipeline-orchestration-as-a-shipped-surface) that `UnknownKeyword` is by construction the ajv-strict rejection set still holds, but on this path ajv is the gate that observes it.

**`run` enforces; `check` reports.** `run` stops at the first gate failure, so a gated document is never written and neither are the targets behind it. `check` is total over the targets and never fails on findings, carrying `blocked` per target instead — reporting is its job, and the same argument that makes `SchemaGateError` carry *all* of one target's blocking findings (do not make a consumer discover problems one run at a time) applies at the target level to a drift report. A blocked target is still never mistaken for clean drift, because `blocked` says so explicitly. This asymmetry was the round-2 adopter's third friction item and is the one place `run` and `check` deliberately differ in more than writing.

## Tier and dependencies

**Integrated tier since 2026-08-04.** Built boundary in phase 2 as this doc anticipated, and flipped when ajv became a direct dependency (see [the ajv question](#the-validation-seam-the-ajv-question)). All IO still lives in `SchemaFile` over core `FileSystem`/`Path` required in `R`, and every other module is still pure — the tier moved because of the engine in the graph, not because IO leaked.

- `effect` is the only peer; see `packages/schemastore/package.json` for the live ranges.
- `@effected/semver` is a **regular dependency, not a peer** — no `SemVer` type surfaces in the public API, and since 2026-08-04 it backs `SchemaVersion` validation as well as ordering (see [versioning](#versioning-schemastores-file-convention-semvers-label-grammar)).
- No `@effected/glob` edge — resolved, see [resolved questions](#resolved-design-questions).
- `ajv` is a regular dependency since 2026-08-04, backing `SchemaValidator.layer`. It is the **only** third-party runtime dependency and the sole reason the package is integrated tier — which is also the guardrail: a second one is a fresh decision, not a free ride on this one.

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
