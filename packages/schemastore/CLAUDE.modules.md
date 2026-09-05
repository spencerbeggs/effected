# Modules — @effected/schemastore

What each module exposes. Surfaces only — the rules that govern them live in the
parent.

**Parent:** [@effected/schemastore context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/schemastore.md`

## Assembly

- `StoreDocument` — the assembly `Schema.Class`
  (`$schema`/`$id`/`root`/`defs`); `draft07({$id, root, defs?})` fills `$schema`
  for hand-built values, and `$schema` stays a real field rather than a
  defaulted one because it declares the document's dialect.
  `fromSchemaResult`/`fromSchema` run core's 2020-12 generation, the Draft-07
  lowering, the `#/definitions` → `#/$defs` `$ref` rewrite (only `$ref` string
  values are rewritten; prose survives) and the `AnnotationCarriers` re-graft —
  the declared families are **always admitted** into `includeAnnotationKey`, and
  a caller predicate is consulted in addition, though its non-declared
  admissions still drop at the lowering. `toJson()` emits the flat publication
  shape, omitting `$defs` when empty (a deliberate divergence from the
  extraction source). `serializeResult` routes through `CanonicalJson`. Fails
  typed with `SchemaConversionError` (`$id` + `cause: Schema.Defect()`).
- `KeywordFamilies` — the owner of the declared non-standard keyword families,
  in two groups: upstream language-server families (the vscode five by exact
  name; the `x-taplo`, `x-tombi-`, `x-intellij-` prefixes) and the house
  machine-annotation namespace `x-ai-` (WITH the dash). `isDeclared` is the
  one predicate over both groups.
- `AnnotationCarriers` — the post-lowering re-graft: `carryResult` (the `Result`
  primitive) / `carry` (the span form) copy declared-family keys from a 2020-12
  node onto its lowered Draft-07 counterpart via a parallel walk mirroring
  core's `toSchemaDraft07` descent, including the coordinate move (2020-12
  `prefixItems[i]` → Draft-07 `items[i]`; trailing `items` →
  `additionalItems`). The depth cap fails typed as
  `CarrierDepthExceededError`.
- `CanonicalJson` — the owned deterministic serializer (it replaced the
  extraction source's biome shell-out): insertion-order keys, tab indent by
  default (`indent` option), LF, single trailing newline. Fails typed
  (`NonJsonValueError` with a JSON-pointer path, `JsonDepthExceededError`)
  instead of `JSON.stringify`'s silent drops of `undefined`/`NaN`/non-plain
  objects.

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
  line should be a docs URL), `DepthExceeded` (hostile nesting degrades to a
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
  `{schema, $id, path, name?, version?}`. `name` is optional so a file-only
  target need not duplicate its path's basename, and versioned naming is
  `name-<version>.json`. `version`'s second meaning: a **pinned** label (no
  prerelease) declares that consumers pin this document's URL, so
  `SchemaPipeline.run` refuses to rewrite it in place under a `"contract"`
  change — only coherent when `version` participates in `path`.
- `SchemaVersioning` — `SchemaVersion` (a branded string) with
  `parseResult`/`parse` and `InvalidSchemaVersionError`; `Order`/`latest` are
  plain SemVer precedence (`1.10.0` > `1.9.0`; the label round-trips verbatim);
  `fileName`/`schemaUrl`/`catalogUrls` derive both catalog modes (`versions: []`
  is a contradiction and throws — pass `undefined` for unversioned). Because no
  SemVer label is array-index-like, the `versions` map's ascending insertion
  order survives serialization. `isPinned(version)` answers "no prerelease" —
  the one predicate shared by `SchemaPipeline`'s contract guard and `next`.
  `next(current, change)` is the version label a `WriteChange` classification
  calls for: identity for `"none"`/`"annotations"`/`"created"` and for a
  non-pinned `current`; otherwise MINOR on the 0.x line, MAJOR above it. Pure,
  total, never mints a prerelease from a stable input.
- `CatalogEntry` — the `Schema.Class` of a catalog.json entry (`versions` is
  `optionalKey`); `assemble` composes `SchemaVersioning.catalogUrls`;
  `lint`/`lintFileMatch` are the fileMatch hygiene checks (`CatalogLintFinding`:
  `GenericFileMatch`, `ComplexFileMatch`) — pure pattern-shape analysis, with no
  `@effected/glob` edge, because the lint never *matches*.
