# Modules — @effected/schemastore

What each module exposes. Surfaces only — the rules that govern them live in the
parent.

**Parent:** [@effected/schemastore context](./CLAUDE.md) ·
**Design doc:** `@./okf/modules/schemastore.md`

## Assembly

- `StoreDocument` — the assembly `Schema.Class`
  (`$schema`/`$id`/`root`/`defs`); `draft07({$id, root, defs?})` fills `$schema`
  for hand-built values, and `$schema` stays a real field rather than a
  defaulted one because it declares the document's dialect.
  `fromSchemaResult`/`fromSchema` run core's 2020-12 generation, the Draft-07
  lowering, the `#/definitions` → `#/$defs` `$ref` rewrite (only `$ref` string
  values are rewritten; prose survives, and a declared-family value is passed
  through verbatim rather than descended into) — the declared families are
  **always admitted** into `includeAnnotationKey`, and a caller predicate that
  admits anything else fails the build with `UndeclaredAnnotationKeyError`
  (`$id` + the sorted, deduplicated `keys`). `StoreDocumentOptions.rootAnnotations`
  is merged onto the assembled root afterwards (override keys win,
  `undefined` skipped; admitted keys are the nine standard annotation
  keywords — `title`, `description`, `$comment`, `default`, `examples`,
  `readOnly`, `writeOnly`, `contentMediaType`, `contentEncoding` — plus the
  declared families, gated up front with the same error; a root that is
  exactly a bare local `$ref` receives the merge on the `$defs` entry it
  names when it is that entry's only referent, and is otherwise rewritten to
  `{ ...overrides, allOf: [{ $ref }] }`). `toJson()` emits the flat publication
  shape, omitting `$defs` when empty (a deliberate divergence from the
  extraction source). `serializeResult` routes through `CanonicalJson`. Fails
  typed with `SchemaConversionError` (`$id` + `cause: Schema.Defect()`).
- `KeywordFamilies` — the owner of the declared non-standard keyword families,
  in two groups: upstream language-server families (the vscode five by exact
  name; the `x-taplo`, `x-tombi-`, `x-intellij-` prefixes) and the house
  machine-annotation namespace `x-ai-` (WITH the dash). `isDeclared` is the
  one predicate over both groups.
- `CanonicalJson` — the owned deterministic serializer (it replaced the
  extraction source's biome shell-out): insertion-order keys, tab indent by
  default (`indent` option), LF, single trailing newline. Fails typed
  (`NonJsonValueError` with a JSON-pointer path, `JsonDepthExceededError`)
  instead of `JSON.stringify`'s silent drops of `undefined`/`NaN`/non-plain
  objects. `equals(left, right)` is parsed-content equality under the same
  semantics — key order ignored, array order significant, `NaN` unequal,
  total past a stack guard of `MAX_NESTING_DEPTH * 8` — consumed by
  `DocumentDiff` and by the CLI's catalog-entry compare.

## Validation, lint and diff

- `SchemaValidator` — real-engine validation, closed by default:
  `SchemaValidator.layer` runs ajv (a meta-schema check keeping ajv's structured
  `instancePath`/`keyword`, then a compile whose strict-mode throw becomes a
  root-pathed finding). `validate(document, {strict?})` answers
  `ValidationFinding` values — empty means a clean pass — and the error channel
  carries `SchemaValidatorError` (`cause: Schema.Defect()`). Also ships `noop`
  (validation off) and `makeTest`/`layerTest` (unstubbed members die naming the
  member).
- `DocumentLint` — a total structural lint returning `DocumentLintFinding`
  values, never an error channel: `UnresolvedRef` (every `$ref` resolves against
  `$defs`; `#` self-refs are fine; a surviving `#/definitions/...` pointer
  warns), `UnknownKeyword` (keyword-position-aware walk over the allowed
  families), `DescriptionWithoutUrl` (advisory — the root description's last
  line should be a docs URL; for a bare local `$ref` root the description is
  read from the `$defs` entry it names, at `/$defs/<name>/description`),
  `DepthExceeded` (hostile nesting degrades to a
  finding).
- `DocumentDiff` — pure classification of two emitted documents as
  `SchemaChange` (`"none"` | `"annotations"` | `"contract"`), keyword-position
  aware like the lint and key-order insensitive. `"annotations"`
  (title/description/`$comment` plus the declared families) means transparently
  replaceable — no new version; `"contract"` is the version-bump signal.
  `isClean(change)` is the predicate for the clean case, so consumers do not
  spell `"none"` (`"created"` is deliberately not clean).

## IO, pipeline and catalog

- `SchemaFile` — the one IO module. `read(path)` answers the file's exact text
  (`SchemaFileNotFoundError` carries its own tag via `reason._tag === "NotFound"`
  routing, with no TOCTOU pre-check; other failures are `SchemaFileReadError`).
  `write(path, document, options?)` serializes through `CanonicalJson`, compares,
  writes only on difference (creating parent directories) and answers
  `{outcome, change}` as a value. `check(path, document, options?)` is the same
  comparison without writing, answering `{wouldWrite, change}` — `change` is
  content (format-immune, the drift question) and `wouldWrite` honors `compare`.
  A comparison-read failure other than not-found fails typed rather than
  silently overwriting; a serialization failure propagates as its own
  `CanonicalJsonError` (a deliberate divergence from `PackageJsonFile`'s
  narrowed write channel — its encode is total, ours is not); filesystem
  failures are `SchemaFileWriteError`.
- `SchemaPipeline` — `run(targets, options?)` generates, lints, validates, gates
  and writes each target, now **two-phase and all-or-nothing**: phase 1
  generates/gates/classifies every target with no writes, phase 2 writes only
  if every target cleared phase 1. `check(targets, options?)` is the same walk
  with no writes, total over the targets. `runOne`/`checkOne` take a single
  target so a one-target caller need not prove element zero exists. Both
  gates' findings normalize into `PipelineFinding`
  (`source`/`severity`/`check`/`path`/`message`; engine findings are always
  `"warning"`) so one predicate judges both; `blocking` defaults to
  `severity === "warning"`. `PipelineFinding.label` is the rendered name
  (`check ?? source`). `run` fails `SchemaGateError` (`$id` + blocking
  findings) or, for a guarded published target whose contract changed,
  `SchemaContractChangeError`; `check` does not fail on findings or the
  contract policy at all. New exports:
  - `ContractChangePolicy` — `"block-versioned"` (default) | `"allow"`; see the
    parent's contract-policy rule.
  - `ContractChangeTarget` — one blocked target: `$id`, `path`, `version`,
    `nextVersion` (`SchemaVersioning.next(version, "contract")`).
  - `SchemaContractChangeError` — `{ targets: ContractChangeTarget[] }`, raised
    before any write, total over the blocked targets.
  - `PipelineCheckResult.contractBlocked` — side by side with `blocked`:
    `blocked` answers "would findings block a run under `blocking`",
    `contractBlocked` answers "would the contract policy refuse this write
    under `contractChanges`".
  Built because three consumers had re-implemented this loop and would have
  diverged on error shape and gating.
- `SchemaTarget` — an interface + statics-only merged class (NOT a
  `Schema.Class`: it carries a live `Schema.Constraint`).
  `{schema, $id, path, name?, version?, published, jsonSchema?, rootAnnotations?}`.
  `name` is optional so a
  file-only target need not duplicate its path's basename, and versioned naming
  is `name-<version>.json`. `version`'s second meaning: a **pinned** label (no
  prerelease) declares that consumers pin this document's URL, so
  `SchemaPipeline.run` refuses to rewrite it in place under a `"contract"`
  change — only coherent when `version` participates in `path`. `jsonSchema?`
  (`Schema.ToJsonSchemaOptions`) is forwarded by `SchemaPipeline` to
  `StoreDocument.fromSchema`, so a target reproduces its document regardless
  of core's `toJsonSchemaDocument` default (e.g. `onExcessProperty: "error"`
  for closed objects post-rc.113; #688). `rootAnnotations?` is forwarded the
  same way to `StoreDocumentOptions.rootAnnotations`.
- `SchemaVersioning` — `SchemaVersion` (a branded string) with
  `parseResult`/`parse` and `InvalidSchemaVersionError`; `Order`/`latest` are
  plain SemVer precedence (`1.10.0` > `1.9.0`; the label round-trips verbatim);
  `fileName`/`schemaUrl`/`catalogUrls` derive both catalog modes (`versions: []`
  is a contradiction and throws — pass `undefined` for unversioned). Labels are
  inserted in ascending `Order`, but a bare-major label (`"2"`) is
  array-index-like and enumerates first regardless — the prose lives once, on
  `CatalogUrls.versions`; derive ordering from the labels (`latest`), never
  from position. `isPinned(version)` answers "no prerelease" —
  the one predicate shared by `SchemaPipeline`'s contract guard and `next`.
  `next(current, change)` is the version label a `WriteChange` classification
  suggests: identity for `"none"`/`"annotations"`/`"created"` and for a
  non-pinned `current`; otherwise a MINOR bump preserving the label's
  component count. Pure, total, never mints a prerelease from a stable input.
  The grammar is `major`, `major.minor` or `major.minor.patch` (plus an
  optional prerelease); missing components order as `0`, so `1`/`1.0`/`1.0.0`
  are one version spelled three ways.
- `DriftPolicy` — the pure classifier the CLI runs over a published target's
  `WriteChange`: `classify({published, change}, policy)` answers a
  `DriftVerdict` (`"write"` | `"drift"`). An unpublished target is NEVER drift
  (regenerated in place until someone depends on its label); `"allow"` writes
  everything, `"semantic"` (the default) holds only `"contract"` changes,
  `"strict"` holds `"annotations"` too. `DriftPolicy.defaults` is
  `{ policy: "semantic", onDrift: "error" }`; `DriftOptions`/`DriftTolerance`/
  `OnDrift` are the option types a config declares and a CLI flag overrides.
- `SchemastoreConfig` — the `schemastore.config.ts` contract, pure and
  IO-free. `defineConfig({outputDir, baseUrl?, drift?, onDrift?,
  catalogPath?, schemas})` takes `schemas` **keyed by file base name** — the
  key IS the `name` every derived path and URL is built from (`assertSimpleName`
  rule: non-empty, no separators, no whitespace). Each entry
  (`{schema, versions?, current?, published?, baseUrl?, layout?, drift?,
  catalog?, jsonSchema?, rootAnnotations?}`) resolves through ONE
  `relativeFile(name, version, layout)`-style derivation that decides `$id`,
  the write `path` and every catalog URL — there are no `$id`/`path`/`name`/
  `version` fields on an entry, all four are derived, and there is
  deliberately **no `$id` override**. `baseUrl: "schemastore"` expands to
  `SCHEMASTORE_ID_BASE`/`SCHEMASTORE_CATALOG_BASE` and forces the `"flat"`
  layout (`layout` under it is an error); a custom `https://` `baseUrl` is
  one base for both `$id` and the catalog URL, defaulting to the
  `"versioned"` layout. `versions` lists every advertised label; `current`
  (default: highest under `SchemaVersioning.Order`) is the one generated,
  the rest become `FrozenVersion` entries the CLI verifies but never
  regenerates. `catalog` (`{description, fileMatch}`) is required under
  `baseUrl: "schemastore"`, optional under a custom host. Validation refuses
  an empty `schemas` record or `outputDir`, a key that fails the simple-name
  rule, an empty/invalid `versions` entry, `current` not among `versions`,
  an invalid `baseUrl`/`layout` combination, a missing/empty-`fileMatch`
  `catalog` where required, an invalid `drift`/`onDrift`, and a duplicate
  output path (target, frozen file or `catalogPath`), after lexical path
  normalisation — every failure is a plain `Error` prefixed
  `defineConfig:` naming the offending schema, never a raw `TypeError`, the
  same shape the CLI wraps into its typed load error. Brands the result with
  a private symbol so `isSchemastoreConfig(value)` recognises a loaded
  module's default export. `CatalogInput`, `SchemaEntryInput`,
  `SchemastoreConfigInput`, `FrozenVersion`, `ResolvedSchema` and
  `SchemastoreConfig` are the input and resolved-output shapes;
  the array-of-targets `catalog`/entry-pair types from the pre-keyed shape
  no longer exist.
  `SchemaTarget.make` survives unchanged as the library-level primitive for
  a caller driving `SchemaPipeline` directly; `defineConfig` lowers each
  entry onto it.
- `CatalogEntry` — the `Schema.Class` of a catalog.json entry (`versions` is
  `optionalKey`); `assemble` composes `SchemaVersioning.catalogUrls`;
  `lint`/`lintFileMatch` are the fileMatch hygiene checks (`CatalogLintFinding`:
  `GenericFileMatch`, `ComplexFileMatch`) — pure pattern-shape analysis, with no
  `@effected/glob` edge, because the lint never *matches*.
