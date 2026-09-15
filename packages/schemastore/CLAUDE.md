# @effected/schemastore

Build, version, validate and lint SchemaStore-shaped Draft-07 JSON Schema
documents from Effect Schema sources: assembly over core's
`Schema.toJsonSchemaDocument` + `JsonSchema.toDocumentDraft07`, annotation
carrying for the language-server keyword families, the catalog vocabulary in
both versioning modes, structural and hygiene lints, canonical JSON text,
write-if-changed IO with change classification, and validation over ajv.

**For the full design:** → `@./okf/modules/schemastore.md`

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
- **A `Schema.Class` root is annotated on the `Struct` it wraps, not on the
  class.** Class-argument or class-level `.annotate()` keys sit on the class
  node; the `$defs` entry is generated from the encoded fields `Struct`, so
  annotate that (`Schema.Class<X>("X")(Schema.Struct({...}).annotate({...}))`).
  By design — Effect-TS/effect#8084 closed as such; re-probed at rc.115.
  `rootAnnotations` (below) is the complement for what that rule cannot
  reach, not a replacement for it.
- **`rootAnnotations` is gated up front and placed by the `$ref` rule.**
  `StoreDocumentOptions.rootAnnotations` (forwarded from
  `SchemaTarget.rootAnnotations` by the pipeline) merges onto the emitted root
  after assembly — override keys win, `undefined` values are skipped. Admitted
  keys are the standard annotation keywords (`title`, `description`,
  `$comment`, `default`, `examples`, `readOnly`, `writeOnly`,
  `contentMediaType`, `contentEncoding` — the last two are Draft-07 §8
  content vocabulary, annotations ajv does not assert) plus the
  declared families; anything else fails `UndeclaredAnnotationKeyError`
  BEFORE generation, naming the override keys (so when both gates would
  fire, the override's keys are reported, not the predicate's) — the
  override is for annotation loss (a filtered field, a class root), never a
  back door for assertion keywords. When the assembled root is exactly a
  bare local `$ref` (`{ $ref: "#/$defs/X" }` — decoded via core's
  `JsonPointer.parseUriFragment`, so a pointer-escaped name resolves) AND
  the root is that entry's only referent, the merge lands on `defs.X`
  instead, because Draft-07 validators ignore `$ref` siblings. When the
  entry has other referents (a recursive class, or one another definition
  reaches — counted over `root` and every `defs` entry, never inside a
  declared-family payload) the root becomes
  `{ ...overrides, allOf: [{ $ref }] }`, the Draft-07 shape that annotates a
  root without titling every occurrence of the type. `DocumentLint`'s
  `DescriptionWithoutUrl` reads the description from the same place
  assembly put it (the entry, at `/$defs/<name>/description`, for a bare
  `$ref` root). Values are shared by reference like `.annotate()` payloads,
  and the `$ref` rewrite never walks them.
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
  own config entry. `DocumentLint.UnknownKeyword` and
  `StoreDocument.fromSchema`'s gate both consume `isDeclared`, so lint and
  gate cannot drift. Never fork the list.
- **The declared families are the WHOLE non-standard surface, and the gate is
  ours — it fails, it does not drop.** A caller-supplied
  `includeAnnotationKey` that admits a key outside the families fails
  `fromSchema` with `UndeclaredAnnotationKeyError` naming the keys; declared
  families are always admitted regardless of what that predicate answers. The
  package once *relied* on core's Draft-07 lowering to drop undeclared keys;
  **effect rc.112 (PR #7420) made the lowering preserve custom keywords**, so
  that reliance silently stopped enforcing anything. Never re-document a core
  behavior as this package's guarantee.
- **There is no post-lowering re-graft.** Since rc.112 the lowering copies
  unknown and custom keywords through as opaque values, in place, including
  across the tuple coordinate move (`prefixItems[i]` → `items[i]`, trailing
  `items` → `additionalItems`) — proven per case in
  `__test__/annotation-carrying.test.ts`, which asserts on the raw
  `JsonSchema.toDocumentDraft07` output with no package code involved.
  `AnnotationCarriers` was deleted as dead weight. The one thing the package
  still owes a declared-family value is that the `#/definitions` → `#/$defs`
  `$ref` rewrite **does not descend into it**: those payloads are opaque
  advice to a language server, and a `$ref`-shaped string inside one must
  survive verbatim.
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
- **`CanonicalJson.equals` is the ONE content-equality rule** — key order
  ignored, array order significant, `NaN` never equal, total past a stack
  guard (`false` rather than an overflow). `DocumentDiff`'s leaf comparison
  and the CLI's catalog-entry compare both consume it; never re-implement a
  `deepEqual` beside it.
- **`SchemaVersion` is a one-to-three-component label** — `major`,
  `major.minor` or `major.minor.patch`, optionally with a prerelease —
  matched by a grammar regex (`LABEL`) first, then checked by
  `@effected/semver`'s parse over the label padded to three components —
  the regex admits the shape, the parse settles validity and rejects build
  metadata. Missing components read as `0` for
  ordering, so `1`, `1.0` and `1.0.0` compare EQUAL under
  `SchemaVersioning.Order` while each label round-trips verbatim (the file
  name keeps the spelling the config wrote). Build metadata is rejected
  (URL-hostile, invisible to precedence); so is surrounding whitespace —
  `SemVer.parseResult` TRIMS, so guard with `SemVer.isValid` first or a padded
  label round-trips into `agripparc- 1.2.3 .json`. The **file-name convention
  stays SchemaStore's `<name>-<version>.json`**; only the label grammar
  diverges.
- **`SchemaVersioning.isPinned` is the ONE predicate shared by the contract
  guard and `next`** — a label with no prerelease. If the two read different
  tests, a caller could be refused a write AND told to keep the same label: a
  deadlock. `next(current, change)` is pure and total, three arms:
  non-contract change → identity (nothing to break); non-pinned `current` →
  identity (a prerelease already declares its own instability); otherwise →
  a MINOR bump that **preserves the component count** (`1` → `2`, since major
  is the only axis a one-component label has; `1.2` → `1.3`; `1.2.3` →
  `1.3.0`). It is a suggestion, not a verdict: the CLI's
  drift policy decides whether a published document may change at all, and
  `DocumentDiff` cannot tell an added optional property from a removed
  required one, so the label only has to be strictly greater and
  conspicuous. It never mints a prerelease from a stable input.
- **`SchemaTarget` requires `name` whenever `version` is present**, enforced by
  an overload pair so version-without-name is a compile error (the runtime throw
  survives for untyped callers). Empty `$id`/`path` throw — wiring defect.
  A target's generation options (`jsonSchema`, core's `ToJsonSchemaOptions`)
  live ON the target and are forwarded to `fromSchema` by the pipeline — never
  add a pipeline-wide equivalent: a document that only reproduces under
  options held elsewhere is not self-describing (#688; the rc.113
  `onExcessProperty` default flip is the motivating case, and the target
  option is what REOPENS a document that was published open, never what
  closes one).
- **Generated objects are closed by default — `fromSchema` spreads
  `onExcessProperty: "error"` ahead of the caller's `jsonSchema`.** Core's
  own default flipped to `"ignore"` (open) at rc.113 and this package does
  not follow it: a published document is a contract, and an open object
  accepts a typo'd key without complaint. `jsonSchema: { onExcessProperty:
  "ignore" }` on a target (or a `defineConfig` entry) reopens that ONE
  document. Breaking for anyone who relied on open objects — the
  reasoning is `okf/decisions/schemastore-closed-objects-by-default.md`;
  never restore core's default silently.
- **`defineConfig` decodes its input with one `Schema.Struct` per level —
  `errors: "all"`, `onExcessProperty: "error"` — and fails with a clear
  `Error` on every malformed input, never with a raw `TypeError`.** The
  decode is the guard: it runs before any dereference, reports every issue
  on an entry at once, and NAMES a typo'd key rather than dropping it
  (`defineConfig: schema "<name>" Expected string at ["baseUrl"]`, decode
  issues collapsed onto one line). The literal unions (`drift`, `onDrift`,
  `layout`) are derived from the exported types through an
  exhaustive-`Record` helper, so the accepted lists cannot drift from the
  types — extend the type and the compiler demands the record entry. Only
  the rules a decode cannot express stay hand-written, AFTER it: an empty
  `schemas` record, a key that is not a simple file base name, a `hosted`
  entry keyed differently from `hosted.name` or spelling a hosting field
  beside it, an entry with no `baseUrl` and no config default, a missing
  `catalog` under `baseUrl: "schemastore"`, and a duplicate output path after
  lexical normalisation. Every failure is a `defineConfig: …` `Error` naming
  the offending schema, the same shape as the CLI's load-error wrap
  (exit `2`). Never add a hand guard for something the struct could decode.
- **Hosting and version rules belong to `HostedSchema`, and `defineConfig`
  delegates to it — never re-implement one in the config.** `HostedSchema`
  is a `Schema.Class` over `{ name, baseUrl, versions?, current?, layout? }`
  whose ONE private `resolve` walk backs both the class check and every
  getter, so what the check admits is exactly what `$id`/`url`/`fileName`
  (and `idFor`/`urlFor`/`fileNameFor`) read. Build one through the named
  constructors — `github({ repo, branch = "main", path?, … })`,
  `schemastore({ … })`, `custom({ baseUrl: string | URL, … })` — which
  validate via a decode and throw a plain `Error` naming the reason; the
  class's `make` buries the same message in `cause`, so it is not the
  documented path. An entry hands the value in as `hosted`: it must be
  keyed by `hosted.name`, must not spell `baseUrl`/`versions`/`current`/
  `layout` beside it, and ignores the config-level `baseUrl` default. An
  entry without `hosted` is lowered onto a `HostedSchema` from its own
  fields and the default, so the two spellings cannot diverge. The point:
  an application derives its `$schema` URL from the same value it hands
  to `defineConfig`, so the URL it writes and the `$id` the CLI emits
  cannot disagree.
- **Identity is derived, never cross-checked: `$id`, the file path and every
  catalog URL come from one `HostedSchema` (`idFor`, `urlFor`,
  `fileNameFor`); there is no `$id` override by design (#715).** Frozen
  labels (`versions` other than `current`) are advertised by the catalog and
  verified on disk by the CLI — existence AND the declared `$id`
  (`FrozenVersion.$id`, which differs from `url` only under
  `"schemastore"`) — never regenerated. `baseUrl: "schemastore"` means two
  hosts — `json.schemastore.org` in `$id`, `www.schemastore.org` in the
  catalog — verified 2026-09-14.
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
  so pipeline documents come from `fromSchema`, which never admits an
  undeclared keyword in the first place (a target's `jsonSchema` may carry an
  `includeAnnotationKey`, but one that admits anything undeclared fails
  `fromSchema`, not the lint). `UnknownKeyword` is therefore unreachable that
  way and the
  **engine** gate is what stops a bad document. Until rc.112 the same
  conclusion held for a different reason — the lowering dropped undeclared
  keywords — so do not restate the mechanism from memory.
- **A validator's error channel is for the mechanism failing**, never for
  findings (the `CatalogResolver` convention). `SchemaValidator.layer` registers
  the declared families before compiling, so ajv cannot reject what
  `DocumentLint` allows, and uses a fresh instance per call so shared `$id`s
  never collide.
- **The engine gate registers the standard `ajv-formats` vocabulary, and ONLY
  the vocabulary — `addFormats(ajv, { keywords: false })`.** Without it, strict
  mode rejects every document using `format` (`date-time`, `uri`, `email`, …)
  as an unknown format, so a consumer cannot express "this string is an
  ISO-8601 instant" and falls back to a `pattern` plus a runtime filter that
  the published document cannot carry (effected#657). An UNKNOWN format string
  is still a strict-mode rejection: registering the standard set is not a
  licence for arbitrary strings. `keywords: false` is load-bearing — the
  plugin's default also registers `formatMaximum` / `formatMinimum` and their
  exclusive variants, which `DocumentLint` answers as unknown keywords, so
  registering them would drift the engine verdict from the lint verdict.
  Registration does NOT move the meta-schema (`validateSchema`) verdict —
  probed on `ajv@8.20.0` / `ajv-formats@3.0.1`.
- **`ajv-formats` is bound with ONE hop and no cast:
  `const addFormats = ajvFormats.default`.** The package does
  `module.exports = exports = formatsPlugin` and then
  `exports.default = formatsPlugin`, so the plugin points at itself and
  `.default` is the callable in BOTH worlds — Node's ESM interop (default
  binding is `module.exports`) and an `__esModule`-honouring bundler (default
  binding is `exports.default`); probed under plain Node ESM,
  `addFormats.default === addFormats`. Calling the default import DIRECTLY is
  a `TS2349`: the shipped `.d.ts` declares `export default` in a CJS-mode file,
  so TypeScript models the default import as the module namespace, which the
  upstream `module.exports` reassignment contradicts. Do NOT reintroduce a
  runtime `typeof imported === "function"` interop shim or an
  `as unknown as` cast — the kit is ESM-only and the one hop is both correct
  and correctly typed.
- **`MAX_NESTING_DEPTH = 256` (`internal/limits.ts`) caps four recursive
  surfaces**; the lint degrades to a `DepthExceeded` finding (lint stays total),
  the others fail typed. `CanonicalJson.equals` (which `DocumentDiff`'s leaf
  comparison consumes) uses its own looser stack guard on purpose
  (`MAX_NESTING_DEPTH * 8`, in `CanonicalJson`) — one shared budget made a
  deep-but-identical document compare as different.
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
