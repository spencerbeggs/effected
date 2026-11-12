---
name: building-schemastore-schemas
description: Use when publishing JSON Schema documents from Effect Schemas with @effected/schemastore and the `effected schema` command — writing or fixing a schemastore.config.ts, deciding whether a schema is published, reading a DRIFT or held line, choosing a version label, annotating a schema for VS Code / taplo / tombi / IntelliJ, wiring schema:build and schema:check into package scripts, turbo and CI, or retiring a hand-rolled generate-schema.ts.
---

# Building SchemaStore schemas

`@effected/schemastore` turns an Effect Schema into a SchemaStore-shaped
Draft-07 JSON Schema document: generate, lint, validate under ajv strict mode,
classify the change against the file on disk, write if the content moved.
The `effected schema` command ships the plumbing every consumer used to write
around it — a config file, `build`, `check` and `validate` subcommands, a
per-schema `published` flag, a drift policy, and exit codes CI can read. An
agent reaches the same engine through the `schema_check`, `schema_build` and
`schema_validate` MCP tools. This skill is for two readers: the agent
adopting the tool in a consumer repository, and the author designing the
schema documents themselves.

The package reference in `effected-packages` (`references/schemastore.md`)
covers the library's module surface — `SchemaPipeline`, `StoreDocument`,
`DocumentDiff`, `SchemaValidator`, `SchemaFile`. This skill does not repeat
it; it covers the config, the document, the versioning and the gate.

## What you reach for

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `defineSchemastore` | `@effected/plugin` | the default export of `schemastore.config.ts` — a record keyed by schema name; validates, derives every `$id`/`path`/catalog URL, fills drift defaults. It is `defineConfig` from `@effected/schemastore` under the tool's name; a repository with only `@effected/mcp` imports `defineConfig` instead |
| `HostedSchema` | `@effected/plugin` in a config; `@effected/schemastore` in runtime code | a schema's identity (`$id`, `url`, `fileName`), built once and handed to the config's `hosted` and to the application that writes `$schema` |
| `SchemaTarget.make` | `@effected/plugin` or `@effected/schemastore` | the library-level primitive `defineConfig` lowers each entry onto; reach for it directly only when driving `SchemaPipeline` outside the CLI |
| `DriftPolicy` | `@effected/plugin` or `@effected/schemastore` | reading the `strict` / `semantic` / `allow` table in code, or a test that classifies a change the way the CLI will |
| `SchemaVersioning` | `@effected/plugin` or `@effected/schemastore` | parsing a label, ordering versions, `next(version, "contract")`, `fileName`/`schemaUrl` for a test asserting the derived layout |
| `CatalogEntry.lintFileMatch` | `@effected/plugin` or `@effected/schemastore` | checking `fileMatch` patterns against SchemaStore's hygiene rules before a reviewer does |
| `effected schema build` / `check` / `validate` | `@effected/plugin` (bin) | the `schema:build` and `schema:check` scripts; `check` is the CI gate; `validate` checks a payload against a published document |
| `schema_check` / `schema_validate` / `schema_build` | `@effected/plugin` or `@effected/mcp` (MCP tools) | an agent checking drift or validating a payload in place (read-only), or writing the documents (`schema_build`) |
| `AjvValidator`, `AjvInstanceValidator` | `@effected/engine/schema` | a program driving `SchemaPipeline` itself needs the shipped ajv engines |
| `KeywordFamilies.isDeclared` | `@effected/plugin` or `@effected/schemastore` | asking whether a non-standard keyword will survive the gate before annotating with it |

Install `@effected/plugin` as a root devDependency through `catalog:effected`;
it brings the `effected` command and the `effected-mcp` server (`@effected/mcp`
alone also works for the MCP tools). The tool and its own copy of
`@effected/schemastore` are built into the package, and its root exports the
whole config authoring surface from that copy: `defineSchemastore`,
`HostedSchema`, `SchemaTarget`, `SchemaVersion`, `SchemaVersioning`,
`DriftPolicy`, `KeywordFamilies`, `CatalogEntry`, `SchemastoreVersion` and
their types. Import a config's values from there, and they always match the
tool. Application code that reads a `HostedSchema` at runtime imports it from
`@effected/schemastore`, a regular dependency, kept on `catalog:effected` so it
is the version the tool carries.

## Standards

- **Put the whole schema setup in one `schemastore.config.ts` and two
  scripts.** `schema:build` runs `effected schema build`, `schema:check` runs
  `effected schema check`; run them next to the config or pass its path (no
  config found is exit `2`); make turbo's `build` depend on `schema:build`. Scripts,
  flags and a drift test are the CLI's job, not a generator script's. See
  [references/config.md](references/config.md) and
  [references/ci-gate.md](references/ci-gate.md).
- **A schema entry is keyed by its own name — never spell `$id` or `path` by
  hand.** They, and every catalog URL, derive from the key, `outputDir`,
  `baseUrl` and `layout`. `baseUrl: "schemastore"` forces the flat layout; a
  custom `baseUrl` defaults to `"versioned"`. See
  [references/config.md](references/config.md).
- **Leave `published` at its default (`false`) until the catalog entry is
  accepted upstream, then flip it that day.** An unpublished schema
  regenerates in place through any change, contract included; a published
  one is held to the drift policy. To change a published schema's contract,
  append a new label to `versions` and make it `current` — never edit the
  old file in place. See
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
  prefixes, and the house `x-ai-` namespace. An undeclared key annotated on
  a schema node is silently dropped — the build passes and the key is gone;
  admitted through `rootAnnotations` or an `includeAnnotationKey` predicate
  it fails the build with `UndeclaredAnnotationKeyError`. See
  [references/document-authoring.md](references/document-authoring.md).
- **Classify a change by what a validator asserts or a tool writes, not by
  Draft-07's taxonomy.** `default`, `examples`, `readOnly` and `writeOnly`
  are contract changes; `x-ai-*` and `markdownDescription` are annotations.
  See [references/document-authoring.md](references/document-authoring.md).
- **Generated objects are closed by default (`additionalProperties:
  false`); pin `jsonSchema: { onExcessProperty: "ignore" }` on the ONE
  target that must stay open.** The package no longer follows core's open
  default, so a config that used to pin `"error"` on every entry can drop
  the pin. See
  [references/document-authoring.md](references/document-authoring.md).
- **When the application writes `$schema` itself, build a `HostedSchema`
  once and hand it to both.** `HostedSchema.github({ repo, path, name,
  versions })` (or `.schemastore(...)` / `.custom(...)`) derives `$id`,
  the catalog URL and the file name; `Schema.Literal(hosted.$id)` in the
  app and `{ schema, hosted }` in the config, keyed by `hosted.name`, so the
  two cannot disagree. See [references/config.md](references/config.md).
- **Run `schema:check` in CI and read its exit code.** `0` is clean (or drift
  under `--on-drift=warn`), `1` is drift, a gate failure, or a stale document
  a build would write, `2` is a config problem, `64` is a usage error. See
  [references/ci-gate.md](references/ci-gate.md).
- **Let an agent use the `schema_*` tools instead of shelling out.**
  `schema_check` and `schema_validate` are read-only and `schema_build`
  writes. Drift and staleness arrive as ordinary results with the verdict;
  only a config that fails to load or a broken engine is a tool error. See
  [references/ci-gate.md](references/ci-gate.md).
- **Build the config from `@effected/plugin`, and align the library through
  the catalog, not the flag.** When a value the config holds comes from an
  `@effected/schemastore` at another version than the one the tool carries,
  the CLI fails with exit `2` naming both versions and `@effected/plugin` as
  the remedy; `--ignore-version-mismatch` runs on with
  a warning, and the MCP tools run and carry a `versionMismatch` warning in
  the result. See [references/ci-gate.md](references/ci-gate.md).
- **Retire the generator script when the config lands** — the script, its
  drift test, the `CATALOGUED`-style constant and the hand-written catalog
  entry. See
  [references/migrating-a-generator-script.md](references/migrating-a-generator-script.md).

## Footguns

- A `versions` label with no file on disk fails the build with
  `FrozenVersionMissingError`, before anything is generated — either
  generate it once as `current` and then freeze it, or drop it from
  `versions`. See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- Relative `outputDir`/`path` values resolve against the config file's
  directory, never the working directory — a root-level run and a filtered
  package run must write the same files. See
  [references/config.md](references/config.md).
- `check` reports `held (drift elsewhere)` for a clean schema when a sibling
  drifted under `onDrift: error`, because nothing is written on a refused
  run — fix the sibling, not the held one. See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- Gate failures (lint warnings, ajv strict findings) exit `1` under either
  `--on-drift` value; `--force` does not touch them. See
  [references/drift-and-versioning.md](references/drift-and-versioning.md).
- A document the build rewrites is in the canonical layout (every array
  expanded), which Biome's default collapses — so `lint` after `schema:build`
  fails in CI while `check` stays green. Scope Biome's `expand: "always"` to
  the generated files. See
  [references/ci-gate.md](references/ci-gate.md#make-the-formatter-agree-with-the-writer).
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
- Configs sharing a merged catalog must share one `catalogDir`, with names
  unique case-insensitively and schema keys unique across configs, or they
  overwrite each other. See
  [references/multi-config.md](references/multi-config.md).
- A failure is the `@effected/cli-kit` standard report on stderr (`✗ DriftError: …`, then an `in:` span line when it failed inside a span); gate on the exit code, never on the line's leading characters.
- Under `--agent` the format defaults to JSON; otherwise a person gets human
  text and `check` shows a coloured line diff. A JSON run puts human text on
  stderr; parse stdout only. See
  [references/ci-gate.md](references/ci-gate.md).

## Out of scope — see the named skill

- The library's pipeline internals (`SchemaPipeline.run` phases,
  `ContractChangePolicy`, `SchemaGateError`) → `effected-packages`,
  `references/schemastore.md`.
- Designing the Effect Schema itself (Class vs Struct, optionality, checks,
  `toJsonSchemaDocument` options) → `effect-v4-schema`.
- Building a CLI on `effect/cli` → `effect-v4-cli`.

## Additional resources

- [references/config.md](references/config.md) — `defineConfig`'s keyed
  shape, every schema-entry field, config discovery, path resolution, and
  the derived `$id`/`path`/catalog `versions`/`url`. Load when: writing or
  debugging a `schemastore.config.ts`, or a catalog entry looks wrong.
- [references/drift-and-versioning.md](references/drift-and-versioning.md) —
  the published × policy × change table, `onDrift`, `--force`, why gate
  failures are never overridable, the one-to-three-component version grammar
  and what `next` suggests. Load when: a run prints `DRIFT` or `held`,
  choosing a label, or deciding whether to bump.
- [references/document-authoring.md](references/document-authoring.md) —
  annotation placement, the declared keyword families and the `x-ai-`
  rules, contract-vs-annotation classification, the closed-by-default objects,
  content-compared writes. Load when: annotating a schema for an editor,
  reading an `UndeclaredAnnotationKeyError`, or asking whether an edit costs
  a version.
- [references/ci-gate.md](references/ci-gate.md) — scripts, turbo wiring,
  the Biome override that makes the formatter agree with the writer, exit
  codes, the JSON report shape, the GitHub step summary, the
  dependency-bump posture, local vs CI. Load when: wiring `schema:check` into
  a workflow, parsing its output, or `lint` fails on a freshly built schema.
- [references/multi-config.md](references/multi-config.md) — several
  `schemastore.config.ts` files publishing into one shared folder and one
  merged `catalog.json`: the worked layout, the convergence rules, removing
  or renaming a config, and reading a blocked merge. Load when: a monorepo
  has more than one config, or configs share an `outputDir`.
- [references/migrating-a-generator-script.md](references/migrating-a-generator-script.md) —
  the `generate-schema.ts` → `schemastore.config.ts` mapping, what to
  delete, and a short section for moving off the retired `schemastore` bin.
  Load when: a repository still owns a hand-rolled generator over
  `SchemaPipeline`, or still calls the retired `schemastore` bin.
