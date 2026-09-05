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
- **`KeywordFamilies` is the ONE owner of the declared non-standard families,
  in two groups.** Upstream language-server families (the vscode five by
  exact name; the `x-taplo`, `x-tombi-`, `x-intellij-` prefixes) are mirrored
  from SchemaStore's CONTRIBUTING; `x-ai-` (WITH the dash — `x-ai` and
  `x-aida-foo` stay undeclared) is the house machine-annotation namespace,
  owned by this package. It is a namespace, not a vocabulary: no enumerated
  key set, any value must be JSON, and the one recommended (non-binding) key
  is `x-ai-hint`. After the prefix a key may use only `[A-Za-z0-9_$:-]` (ajv
  holds a keyword name to `/^[a-z_$][a-z0-9_$:-]*$/i`) — a dot, space, slash,
  `@`, `+` or non-ASCII character makes the engine gate reject the document
  as a finding. A declared-family value must not contain an `$id` (or a
  repeated `$anchor`) at ANY depth, not merely as a top-level key — ajv's
  reference collection walks unknown keywords for them — and an empty-string
  `$id` resolves to the root id and collides too; a collision fails the
  compile. No upstream sanctions `x-ai-`; it is intended for
  self-hosted publication, not schemastore.org submission without that repo's
  own config entry. `DocumentLint.UnknownKeyword` and `AnnotationCarriers`
  both consume `isDeclared`, so lint and carriers cannot drift. Never fork
  the list.
- **Carriers re-graft *after* the Draft-07 lowering**, which drops every keyword
  outside its fixed copy-list. The parallel walk must mirror core's descent
  exactly, including the coordinate move `prefixItems[i]` → `items[i]`.
- **`DocumentDiff`'s governing principle: a keyword is a CONTRACT change when
  it alters what a validator asserts or what data a generic tool writes into
  an instance; one that alters only advice to a reader — human or machine —
  is an ANNOTATION.** That is why `default` / `examples` / `readOnly` /
  `writeOnly` are NOT documentation despite sitting in Draft-07's own
  annotation vocabulary — consumers act on them — while `x-ai-*` IS an
  annotation: it advises a machine reader, asserts nothing. Adopting `x-ai-*`
  on an already-published versioned document therefore rewrites that file in
  place rather than cutting a version. Misreporting a contract change as
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
- **`SchemaVersioning.isPinned` is the ONE predicate shared by the contract
  guard and `next`** — a label with no prerelease. If the two read different
  tests, a caller could be refused a write AND told to keep the same label: a
  deadlock. `next(current, change)` is pure and total, four arms: non-contract
  change → identity (nothing to break); non-pinned `current` → identity (a
  prerelease already declares its own instability); `major === 0` → MINOR
  bump (0.x treats MINOR as the breaking axis); otherwise → MAJOR. It never
  mints a prerelease from a stable input, and it encodes "strictly greater
  and conspicuous," not SemVer compatibility — `DocumentDiff` cannot tell an
  added optional property from a removed required one, so every contract
  change reads as breaking.
- **`SchemaTarget` requires `name` whenever `version` is present**, enforced by
  an overload pair so version-without-name is a compile error (the runtime throw
  survives for untyped callers). Empty `$id`/`path` throw — wiring defect.
- **`SchemaPipeline` is a plain function, deliberately not a `Context.Service`**
  — it needs `SchemaFile | SchemaValidator` in `R`, which compose for free.
  `run` is **two-phase and all-or-nothing across targets**: phase 1 generates,
  gates (fail-fast on `SchemaGateError`) and, for a guarded target, classifies
  against its predecessor — nothing is written yet; phase 2 writes only if
  every target cleared phase 1. "Stops at the first failing target" is no
  longer accurate — a gate failure on target 3 leaves targets 1 and 2 unwritten
  too, not merely target 3. `check` is **total over the targets**, reporting
  `blocked` (and now `contractBlocked`) per target instead of stopping.
  Findings come back as values, and `blocking` is overridable because
  **gating is policy, not mechanism**.
- **`contractChanges` (default `"block-versioned"`) is the second policy,
  keyed on `SchemaVersioning.isPinned(target.version)`.** A pinned versioned
  target is a published, URL-pinned document: a `"contract"` change refuses
  with `SchemaContractChangeError` BEFORE any write, total over targets like
  the gate. `"allow"` is the escape hatch — classify and report only — AND
  the sanctioned repair path for a corrupted published file: `SchemaFile`
  classifies unparseable text as `"contract"` so it stays regenerable (see
  the IO rule above), and the default policy would otherwise refuse that
  exact repair. The policy is only coherent when the version participates in
  `path` (`schemas/<version>/<name>-<version>.json`) — a fixed path with a
  bumped `version` compares the same file forever. `SchemaGateError` takes
  precedence over the contract guard: a document the engine rejects is never
  written under any contract policy, so its classification is noise.
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
