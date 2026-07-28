---
status: draft
module: effected
category: architecture
created: 2026-07-28
updated: 2026-07-28
last-synced: 2026-07-28
completeness: 68
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - config-file.md
  - semver.md
---

# @effected/schemastore design (proposed)

## Overview

`@effected/schemastore` is a **proposed** package — this doc is the design-first step of the [migration playbook](../migration-playbook.md); **no code exists yet**. It is a reusable way to build, validate, version and publish JSON Schema documents generated from Effect Schema sources, in the shape SchemaStore (schemastore.org) and its consuming toolchain (vscode-json-languageservice, redhat yaml-language-server, taplo, tombi, IntelliJ) expect — plus the catalog-entry and editor/toolchain association artifacts around them.

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

## Proposed module surface

Module-per-concept per the [module layout standard](../effect-standards.md#module-layout-module-per-concept); no barrel re-exports below the entrypoint. Proposed modules:

- **`StoreDocument`** (naming open — alternative `SchemaDocument`) — the pure assembly: (Effect Schema, `$id`, options) → Draft-07 SchemaStore document with `$schema`/`$id`/root/`$defs` and the `#/definitions`→`#/$defs` ref rewrite owned here. Wraps core's `Schema.toJsonSchemaDocument` + `JsonSchema.toDocumentDraft07`; the package owns assembly and publication shape, **not** a JSON Schema engine.
- **`SchemaTarget`** — the target manifest vocabulary: schema + identity + destination path + optional version, N per repo (the extraction source's `{schema, $id, path}` triples, generalized).
- **`SchemaVersioning`** — both catalog modes: an unversioned target (plain name, `url` only) and versioned targets (`name-<version>.json` filename derivation, `versions` map assembly, `url` = latest). Version ordering probably via `@effected/semver` (workspace dep) — recorded as a likely dependency.
- **`CatalogEntry`** — Schema classes for the catalog.json entry shape (`{name, description, fileMatch, url, versions?}`), plus fileMatch hygiene lint (generic-pattern and complex-glob warnings) as pure checks.
- **Annotation carriers** for the non-standard property families (taplo/tombi/vscode/intellij) so Effect Schema annotations flow into emitted documents — the generic successor to config-file-effect's taplo/tombi support. The exact mechanism (Effect Schema annotations → emitted keywords) is an open design question to resolve against the installed beta's annotation API during implementation.
- **`DocumentLint`** — owned structural checks over the emitted document: every `$ref` resolves against the `$defs` pool; no unknown keywords outside the declared non-standard families; SchemaStore best-practice advisories such as the description-URL convention. Tractable because the input is bounded `toJsonSchemaDocument` output.
- **`SchemaFile`** — the one IO module, mirroring `@effected/package-json`'s `PackageJsonFile` pattern: write-if-changed over core `FileSystem`/`Path` in `R`, canonical JSON serialization owned by the package (fixing the biome shell-out wart), plus a read side for drift tests.

## The validation seam: the ajv question

SchemaStore's own gate is ajv strict mode, so the package needs a story for real-engine validation. Options:

- **(a) ajv as a runtime dependency** — **rejected.** It makes the package integrated-tier and drags a JSON Schema engine into every consumer's graph, when many consumers only need assembly and lint.
- **(b) a `SchemaValidator` contract seam** — interface + error type only, closed by the consumer with real ajv at the edge. The same contract-seam inversion as `@effected/commands`' `LocalExec` and `@effected/npm`'s resolver contracts.
- **(c) owned structural checking only** — `DocumentLint` in the package, ajv left entirely to consumer CI.

**Recommended: (b)+(c).** `DocumentLint` is owned and always available; the `SchemaValidator` seam carries real-engine validation without ajv ever entering the dependency graph.

## Tier and dependencies

**Boundary tier.** One IO module (`SchemaFile`) over core `FileSystem`/`Path` required in `R`; everything else pure; no third-party runtime dependencies under the recommended validation option.

- `peerDependencies`: `effect` (`catalog:effect`); likely `@effected/semver` (`workspace:~`) for version ordering in `SchemaVersioning`.
- Possibly `@effected/glob` for fileMatch pattern analysis in `CatalogEntry` — an open question; the hygiene lint may need only simple structural checks.
- No ajv, no JSON Schema engine, anywhere in the runtime graph.

## Scope fence: the @effected/json-schema ghost

The repo's CLAUDE.md records that `@effected/json-schema` is off the roadmap entirely — core's `JsonSchema` module made it redundant. This package must stay the narrow publication/catalog/versioning/lint layer and **must not grow into a general JSON Schema package**. Anything that smells like schema construction, ref resolution beyond the document's own `$defs` pool, or dialect conversion belongs to core's `JsonSchema`, not here. This is an explicit non-goal, not a deferral.

## Open questions

- **Module naming**: `StoreDocument` vs `SchemaDocument` for the assembly module.
- **Annotation mechanism**: how Effect Schema annotations map to emitted non-standard keywords, to be resolved against the installed beta's annotation API during implementation.
- **`@effected/glob` dependency**: whether fileMatch hygiene lint warrants the full pattern-analysis package or simple structural checks suffice.

## Non-goals (v1)

- The SchemaStore coverage tool's 8 checks (candidate inspiration only).
- Generating positive/negative test fixtures.
- Submitting PRs to SchemaStore — the package produces artifacts, humans submit.
- A general JSON Schema package (the scope fence above).
- Formatting of emitted files beyond canonical JSON — presentation formatting is the consumer's concern.

## Status and sequencing

Design-first per the [migration playbook](../migration-playbook.md); this doc is that first step, and implementation follows only if the package is approved for the roadmap. It is **not** on any current release gate and is a post-rebuild roadmap item — the silk-runtime-action dogfood loop is active and holds releases. The package is deliberately absent from `package-inventory.md` and `roadmap.md` until approved; catalog integration happens then, not now.
