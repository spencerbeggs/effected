---
name: building-schemastore-schemas
description: Use when publishing JSON Schema documents from Effect Schemas with @effected/schemastore and the schemastore CLI — writing or fixing a schemastore.config.ts, deciding whether a schema is published, reading a DRIFT or held line, choosing a version label, annotating a schema for VS Code / taplo / tombi / IntelliJ, wiring schema:build and schema:check into package scripts, turbo and CI, or retiring a hand-rolled generate-schema.ts.
when_to_use: schemastore.config.ts, defineConfig, SchemaTarget.make, published flag, schemastore build, schemastore check, schema:build, schema:check, DRIFT contract, held (drift elsewhere), --on-drift, --force, --drift=allow, nextVersion, suggest 1.3, catalog-entry.json, fileMatch, baseUrl, markdownDescription, x-taplo, x-tombi-, x-intellij-, x-ai-hint, UndeclaredAnnotationKeyError, onExcessProperty, generate-schema.ts, SchemaStore submission, JSON Schema from Effect Schema
---

# Building SchemaStore schemas

`@effected/schemastore` turns an Effect Schema into a SchemaStore-shaped
Draft-07 JSON Schema document: generate, lint, validate under ajv strict mode,
classify the change against the file on disk, write if the content moved.
`@effected/schemastore-cli` ships the plumbing every consumer used to write
around it — a config file, a `build` and a `check` command, a per-schema
`published` flag, a drift policy, and exit codes CI can read. This skill is
for two readers: the agent adopting the pair in a consumer repository, and the
author designing the schema documents themselves.

The package reference in `effected-packages` (`references/schemastore.md`)
covers the library's module surface — `SchemaPipeline`, `StoreDocument`,
`DocumentDiff`, `SchemaValidator`, `SchemaFile`. This skill does not repeat
it; it covers the config, the document, the versioning and the gate.

## What you reach for

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `defineConfig` | `@effected/schemastore` | the default export of `schemastore.config.ts` — validates, fills drift defaults, derives every catalog entry |
| `SchemaTarget.make` | `@effected/schemastore` | one entry per emitted document: `schema`, `$id`, `path`, and for a versioned document `name` + `version` (+ `published`) |
| `DriftPolicy` | `@effected/schemastore` | reading the `strict` / `semantic` / `allow` table in code, or a test that classifies a change the way the CLI will |
| `SchemaVersioning` | `@effected/schemastore` | parsing a label, ordering versions, `next(version, "contract")`, `fileName`/`schemaUrl` for a test asserting the derived layout |
| `CatalogEntry.lintFileMatch` | `@effected/schemastore` | checking `fileMatch` patterns against SchemaStore's hygiene rules before a reviewer does |
| `schemastore build` / `schemastore check` | `@effected/schemastore-cli` (bin) | the `schema:build` and `schema:check` scripts; `check` is the CI gate |
| `KeywordFamilies.isDeclared` | `@effected/schemastore` | asking whether a non-standard keyword will survive the gate before annotating with it |

Nothing is importable from `@effected/schemastore-cli`. Every type a config
needs comes from `@effected/schemastore`, which the CLI declares as a peer —
install both at the same version, with `effect`, as devDependencies.

## Standards

- **Put the whole schema setup in one `schemastore.config.ts` and two
  scripts.** `schema:build` runs `schemastore build`, `schema:check` runs
  `schemastore check`; make turbo's `build` depend on `schema:build`. Scripts,
  flags and a drift test are the CLI's job, not a generator script's. See
  [references/config.md](references/config.md) and
  [references/ci-gate.md](references/ci-gate.md).
- **Lay versioned files out flat under the catalog's `baseUrl`.** A catalog
  entry's `url` and every `versions` value derive as
  `<baseUrl>/<name>-<version>.json`; each versioned schema's `$id` must be that
  exact URL and its `path` must sit directly under the directory `baseUrl`
  names. See [references/config.md](references/config.md).
- **Leave `published` at its default (`false`) until the catalog entry is
  accepted upstream, then flip it that day.** An unpublished schema
  regenerates in place through any change, contract included; a published
  one is held to the drift policy. See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- **Answer a `DRIFT contract` line by bumping the version in the config, not
  by forcing.** The CLI suggests a minor bump; bump major yourself when you
  know the change is breaking. `--force` is `--drift=allow` for one run and
  rewrites a URL consumers pin. See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- **Annotate at the definition site, and annotate a `Schema.Class` root on
  the `Struct` it wraps.** A usage-site annotation on a hoisted schema carries
  nothing; a class-level annotation never reaches the `$defs` entry. See
  [references/document-authoring.md](references/document-authoring.md).
- **Use only the declared keyword families for non-standard keys** — the
  vscode five by exact name, the `x-taplo`, `x-tombi-`, `x-intellij-`
  prefixes, and the house `x-ai-` namespace. An undeclared key fails the
  build; it is never silently dropped. See
  [references/document-authoring.md](references/document-authoring.md).
- **Classify a change by what a validator asserts or a tool writes, not by
  Draft-07's taxonomy.** `default`, `examples`, `readOnly` and `writeOnly`
  are contract changes; `x-ai-*` and `markdownDescription` are annotations.
  See [references/document-authoring.md](references/document-authoring.md).
- **Pin every target's generation options on the target** —
  `jsonSchema: { onExcessProperty: "error" }` for a closed document — so the
  document reproduces regardless of core's default. See
  [references/document-authoring.md](references/document-authoring.md).
- **Run `schema:check` in CI and read its exit code.** `0` is clean (or drift
  under `--on-drift=warn`), `1` is drift, a gate failure, or a stale document
  a build would write, `2` is a config problem, `64` is a usage error. See
  [references/ci-gate.md](references/ci-gate.md).
- **Retire the generator script when the config lands** — the script, its
  drift test, the `CATALOGUED`-style constant and the hand-written catalog
  entry. See
  [references/migrating-a-generator-script.md](references/migrating-a-generator-script.md).

## Footguns

- A versioned `$id` under a `schemas/<version>/` subdirectory produces a
  catalog entry that 404s: the derived URL is flat, and the CLI does not
  cross-check `$id` against it. See
  [references/config.md](references/config.md).
- Relative `path` values resolve against the config file's directory, never
  the working directory — a root-level run and a filtered package run must
  write the same files. See [references/config.md](references/config.md).
- `check` reports `held (drift elsewhere)` for a clean schema when a sibling
  drifted under `onDrift: error`, because nothing is written on a refused
  run — fix the sibling, not the held one. See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- Gate failures (lint warnings, ajv strict findings) exit `1` under either
  `--on-drift` value; `--force` does not touch them. See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- `1`, `1.0` and `1.0.0` are one version — `defineConfig` rejects two
  spellings of it under one name — and a bare-major label enumerates ahead of
  every dotted key in the catalog's `versions` map (cosmetic; SchemaStore reads
  it by key). See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- Adopting `x-ai-*` on an already-published document rewrites it in place —
  correct, since annotations are transparently replaceable — while adding a
  `default` bumps a version. See
  [references/document-authoring.md](references/document-authoring.md).
- An `x-ai-*` payload carrying an `$id` (or a repeated `$anchor`) at any depth
  fails the ajv compile; so does a key with a dot, space, slash, `@`, `+` or
  non-ASCII character after the prefix. See
  [references/document-authoring.md](references/document-authoring.md).
- A `--format=json` run puts human text on stderr; parse stdout only. See
  [references/ci-gate.md](references/ci-gate.md).

## Out of scope — see the named skill

- The library's pipeline internals (`SchemaPipeline.run` phases,
  `ContractChangePolicy`, `SchemaGateError`) → `effected-packages`,
  `references/schemastore.md`.
- Designing the Effect Schema itself (Class vs Struct, optionality, checks,
  `toJsonSchemaDocument` options) → `effect-v4-schema`.
- Building a CLI on `effect/unstable/cli` → `effect-v4-cli`.

## Additional resources

- [references/config.md](references/config.md) — `defineConfig` and its three
  blocks, every `SchemaTarget.make` field, config discovery, path resolution,
  the derived catalog `versions`/`url` and the `$id` rule. Load when: writing
  or debugging a `schemastore.config.ts`, or a catalog entry looks wrong.
- [references/drift-and-versioning.md](references/drift-and-versioning.md) —
  the published × policy × change table, `onDrift`, `--force`, why gate
  failures are never overridable, the one-to-three-component version grammar
  and what `next` suggests. Load when: a run prints `DRIFT` or `held`,
  choosing a label, or deciding whether to bump.
- [references/document-authoring.md](references/document-authoring.md) —
  annotation placement, the declared keyword families and the `x-ai-`
  rules, contract-vs-annotation classification, the `onExcessProperty` pin,
  content-compared writes. Load when: annotating a schema for an editor,
  reading an `UndeclaredAnnotationKeyError`, or asking whether an edit costs
  a version.
- [references/ci-gate.md](references/ci-gate.md) — scripts, turbo wiring,
  exit codes, the JSON report shape, the GitHub step summary, the
  dependency-bump posture, local vs CI. Load when: wiring `schema:check` into
  a workflow or parsing its output.
- [references/migrating-a-generator-script.md](references/migrating-a-generator-script.md) —
  the `generate-schema.ts` → `schemastore.config.ts` mapping and what to
  delete. Load when: a repository still owns a hand-rolled generator over
  `SchemaPipeline`.
