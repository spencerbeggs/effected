# @effected/schemastore

Build, version, validate and lint SchemaStore-shaped Draft-07 JSON Schema
documents from Effect Schema sources: assembly over core's
`Schema.toJsonSchemaDocument` + `JsonSchema.toDocumentDraft07`, annotation
carrying for the language-server keyword families, the catalog vocabulary in
both versioning modes, structural and hygiene lints, canonical JSON text,
write-if-changed IO with change classification, and validation over ajv.

**For the full design:** → `@../../.claude/design/effected/packages/schemastore.md`

Load when changing an emitted shape, the versioning grammar or the gating model.

## Child context files

Children carry surfaces and evidence; **every rule is here**.

- Modules → `@./CLAUDE.modules.md` — Load when: changing or extending a module, or asking what one exposes.
- Verification → `@./CLAUDE.verification.md` — Load when: touching the suite, or before re-litigating a "does core do X?" question — the beta-probed facts, hardening budget and test pins live there.

## Tier: integrated (since 2026-08-04)

**Flipped from boundary by owner decision (dogfood round 1, item 3).** `ajv` is
a **direct runtime dependency**: `SchemaValidator.layer` is a shipped
real-engine implementation, not a contract-only seam. The flip overturns a
stated principle knowingly: this is build-time tooling installed as a
devDependency, SchemaStore's own gate IS ajv strict mode, and purity here only
made every consumer write the same adapter, worse (one collapsed ajv's
structured errors into a single `path: ""` finding). **The seam survives as an
interface** (`noop`, `makeTest`/`layerTest`, a substitutable engine), not as a
requirement.

All IO lives in `src/SchemaFile.ts` — one module, one `Context.Service`, over
core `FileSystem`/`Path` required in `R` (the `PackageJsonFile` pattern: no
platform package, the consumer provides one at the edge). **Every other module
is pure; keep it that way.** Peers on `effect`; one regular `workspace:^` edge
on `@effected/semver` (version ordering only — no `SemVer` type surfaces
publicly); `@effect/platform-node` is a devDependency for the integration tests.

## Scope fence

`@effected/json-schema` is off the roadmap because core's `JsonSchema` made it
redundant. Core owns the generation pipeline; this package owns the SchemaStore
shape around it and **must not grow into a general JSON Schema package**: no
schema construction, no ref resolution beyond the document's own `$defs` pool,
no dialect conversion. Depending on ajv does not widen the fence — ajv is the
validation gate, not a construction surface.

## Rules

- **Annotate at the definition site.** A usage-site annotation on a *hoisted*
  (identifier'd) schema reaches nothing, even at 2020-12 — probed at beta.101.
- **`KeywordFamilies` is the ONE owner of the declared non-standard families**
  (the vscode five by exact name; the `x-taplo`, `x-tombi-`, `x-intellij-`
  prefixes). `DocumentLint.UnknownKeyword` and `AnnotationCarriers` both consume
  `isDeclared`, so lint and carriers cannot drift. Never fork the list.
- **Carriers re-graft *after* the Draft-07 lowering**, which drops every keyword
  outside its fixed copy-list. The parallel walk must mirror core's descent
  exactly, including the coordinate move `prefixItems[i]` → `items[i]`.
- **`default` / `examples` / `readOnly` / `writeOnly` are NOT documentation** in
  `DocumentDiff` — consumers act on them. Misreporting a contract change as
  `"annotations"` ships a silent break; the reverse costs a version bump.
- **`SchemaFile` compares by content, not bytes** (`compare: "bytes"` is the
  opt-in). Content comparison is what makes write-if-changed survive a repo
  whose formatter also owns the file's text (effected#262); byte comparison
  rewrote forever and `"unchanged"` was unreachable.
- **`outcome` / `wouldWrite` are the authoritative "was/would the file be
  touched" answers — never infer it from `change`**, which is `"none"` on a
  `compare: "bytes"` write. `write` and `check` share ONE `compare` helper so
  they cannot disagree, and `check` never writes (a CI drift job must not
  regenerate). An existing file that does not parse is classified `"contract"`
  and repaired, not failed — a corrupted generated file stays regenerable.
- **`CanonicalJson` emits keys in insertion order — never sorted** (assembly
  owns ordering). Tab indent by default, LF, one trailing newline; non-JSON
  values fail typed instead of `JSON.stringify`'s silent drops.
- **`SchemaVersion` is a full three-component SemVer label**, enforced by
  `@effected/semver`'s parse, not a parallel regex. Build metadata is rejected
  (URL-hostile, invisible to precedence); so is surrounding whitespace —
  `SemVer.parseResult` TRIMS, so guard with `SemVer.isValid` first or a padded
  label round-trips into `agripparc- 1.2.3 .json`. The **file-name convention
  stays SchemaStore's `<name>-<version>.json`**; only the label grammar
  diverges.
- **`SchemaTarget` requires `name` whenever `version` is present**, enforced by
  an overload pair so version-without-name is a compile error (the runtime throw
  survives for untyped callers). Empty `$id`/`path` throw — wiring defect.
- **`SchemaPipeline` is a plain function, deliberately not a `Context.Service`**
  — it needs `SchemaFile | SchemaValidator` in `R`, which compose for free.
  `run` stops at the first failing target so a gated document is never written;
  `check` is **total over the targets**, reporting `blocked` per target instead
  of stopping. Findings come back as values, and `blocking` is overridable
  because **gating is policy, not mechanism**.
- **Know which gate actually blocks in the pipeline**: targets carry a `Schema`,
  so the lowering drops undeclared keywords before `DocumentLint` runs —
  `UnknownKeyword` is unreachable that way and the **engine** gate is what stops
  a bad document.
- **A validator's error channel is for the mechanism failing**, never for
  findings (the `CatalogResolver` convention). `SchemaValidator.layer` registers
  the declared families before compiling, so ajv cannot reject what
  `DocumentLint` allows, and uses a fresh instance per call so shared `$id`s
  never collide.
- **`MAX_NESTING_DEPTH = 256` (`internal/limits.ts`) caps four recursive
  surfaces**; the lint degrades to a `DepthExceeded` finding (lint stays total),
  the others fail typed. `DocumentDiff`'s leaf comparison uses a looser stack
  guard on purpose — one shared budget made a deep-but-identical document
  compare as different.
- **`DRAFT_07_META_SCHEMA` keeps its trailing `#`** where core's URI constant
  omits it — a documented divergence, not a typo.

## Working here

Tests live in `__test__/` (`@effect/vitest`, `assert.*` — never `expect`);
`SchemaFile`'s real-IO tests are under `integration/`.

```bash
pnpm vitest run packages/schemastore --coverage.enabled=false
pnpm build --filter @effected/schemastore
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`
and leaves a truncated `issues.json` shaped like a clean gate.

`savvy.build.ts` carries one narrow suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the heritage
symbols; `SchemaTarget`'s class/interface merge carries the house
`biome-ignore lint/suspicious/noUnsafeDeclarationMerging` with the standard
statics-only justification. `package.json` stays `"private": true` — the bundler
emits the publishable manifest.
