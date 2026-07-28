# @effected/schemastore

Build, version and lint SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources: document assembly over core's `Schema.toJsonSchemaDocument` + `JsonSchema.toDocumentDraft07`, the catalog-entry vocabulary with both versioning modes, structural and hygiene lints, and canonical JSON text.

**Tier: pure (phase 1).** Peer-depends on `effect`; one regular `workspace:~` edge on `@effected/semver` (version ordering only — no `SemVer` type surfaces publicly). No IO anywhere in `src/`. **The package goes boundary at phase 2**, when `SchemaFile` (write-if-changed over core `FileSystem`/`Path` in `R`) lands; the `SchemaValidator` contract seam and the annotation carriers are also phase-2. Generalizes the silk-release-action `generate-schema.ts` extraction source; second consumer is the silk-runtime-action rebuild.

**For the full design:** → `@../../.claude/design/effected/packages/schemastore.md`

## Scope fence

`@effected/json-schema` is off the roadmap because core's `JsonSchema` made it redundant. This package is the narrow publication/catalog/versioning/lint layer and **must not grow into a general JSON Schema package**: no schema construction, no ref resolution beyond the document's own `$defs` pool, no dialect conversion. Core owns the pipeline; this package owns the SchemaStore shape around it.

## Modules

- `StoreDocument` — the assembly (`Schema.Class`: `$schema`/`$id`/`root`/`defs`). `fromSchemaResult`/`fromSchema` run core's 2020-12 generation, the Draft-07 lowering, and the `#/definitions` → `#/$defs` `$ref` rewrite (only `$ref` string values are rewritten; prose survives). `toJson()` emits the flat publication shape, omitting `$defs` when empty (deliberate divergence from the extraction source). `serializeResult` routes through `CanonicalJson`. Fails typed with `SchemaConversionError` (`$id` + `cause: Schema.Defect()`).
- `SchemaTarget` — interface + statics-only merged class (NOT a `Schema.Class`: it carries a live `Schema.Constraint`). `{schema, $id, name, path, version?}`; empty identity fields throw (wiring defect).
- `SchemaVersioning` — `SchemaVersion` (branded string; grammar `major[.minor[.patch]][-prerelease]`, leading zeros rejected) with `parseResult`/`parse` and `InvalidSchemaVersionError`; `Order`/`latest` pad labels to full SemVer internally via `@effected/semver` (`1.10` > `1.9` numerically; the label round-trips verbatim); `fileName`/`schemaUrl`/`catalogUrls` derive both catalog modes (`versions: []` is a contradiction and throws — pass `undefined` for unversioned).
- `CatalogEntry` — `Schema.Class` of the catalog.json entry (`versions` is `optionalKey`); `assemble` composes `SchemaVersioning.catalogUrls`; `lint`/`lintFileMatch` are the fileMatch hygiene checks (`CatalogLintFinding`: `GenericFileMatch`, `ComplexFileMatch`) — pure pattern-shape analysis, no `@effected/glob` edge (a recorded decision: the lint never *matches*).
- `DocumentLint` — total structural lint returning `DocumentLintFinding` values (never an error channel): `UnresolvedRef` (every `$ref` resolves against `$defs`; `#` self-refs ok; a surviving `#/definitions/...` pointer warns), `UnknownKeyword` (keyword-position-aware walk; allowed families: Draft-07 + `x-taplo*`, `x-tombi-*`, `x-intellij-*`, the vscode five), `DescriptionWithoutUrl` (advisory, root description's last line should be a docs URL), `DepthExceeded` (hostile nesting degrades to a finding).
- `CanonicalJson` — the owned deterministic serializer (fixes the extraction source's biome shell-out): insertion-order keys (assembly owns ordering — never sorted), tab indent by default (`indent` option), LF, single trailing newline. Fails typed (`NonJsonValueError` with a JSON-pointer path, `JsonDepthExceededError`) instead of `JSON.stringify`'s silent drops/rewrites of `undefined`/`NaN`/non-plain objects.

## Verified-against-the-beta facts (do not re-litigate from memory)

- `Schema.toJsonSchemaDocument(schema: Constraint, options?)` → `JsonSchema.Document<"draft-2020-12">` and `JsonSchema.toDocumentDraft07` exist as used (vendored source, `effect@4.0.0-beta.101`).
- The Draft-07 lowering rewrites `#/$defs` refs to `#/definitions` AND **drops every keyword outside its fixed copy-list** — probed: `includeAnnotationKey`-admitted keys (`x-taplo`, `markdownDescription`, ...) survive at 2020-12 and vanish after lowering. **Phase-2 annotation carriers must re-graft after the lowering**, not ride `ToJsonSchemaOptions` alone. `additionalProperties`/descriptions do survive.
- Core's generator is total over `Schema.declare` (emits `{"type":"null"}` rather than throwing) — so `SchemaConversionError`'s fireable path in tests is the package's own rewrite depth cap.
- `DRAFT_07_META_SCHEMA` keeps the trailing `#` (SchemaStore corpus convention); core's `JsonSchema.META_SCHEMA_URI_DRAFT_07` omits it — deliberate divergence, documented on the constant.

## Hardening

`internal/limits.ts` holds the kit parity constant `MAX_NESTING_DEPTH = 256`. Three recursive surfaces are capped: the `$ref` rewrite (fails typed via `SchemaConversionError`), the lint walk (degrades to a `DepthExceeded` finding — lint stays total), and the canonical emitter (fails typed `JsonDepthExceededError`, which also intercepts cycles).

## Testing

59 tests in `__test__/` (`@effect/vitest`, `assert.*` — never `expect`). Discriminating pins: the `#/definitions`→`#/$defs` rewrite touches only `$ref` values (prose survives); numeric-not-lexical ordering (`1.10` > `1.9`); keyword-position awareness (a property *named* `unevaluatedProperties` is not flagged; `enum`/`const`/`default`/`examples` are data positions); firing + clean-pass per lint check; both catalog modes round-trip through the `CatalogEntry` codec. Mutants run and killed (see the phase-1 report): rewrite-all-strings, lexical order, properties-map-as-schema, dropped trailing newline, url-at-oldest.

## Working here

```bash
pnpm vitest run packages/schemastore --coverage.enabled=false   # this package's tests
pnpm build --filter @effected/schemastore                        # dev + prod, in order
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev` and leaves a truncated `issues.json` shaped like a clean gate.

`savvy.build.ts` carries the one narrow suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }` (8 suppressed heritage symbols). `SchemaTarget`'s class/interface merge carries the house `biome-ignore lint/suspicious/noUnsafeDeclarationMerging` with the standard statics-only justification (precedent: `tsconfig-json`'s `ResolvedTsconfig`). `package.json` stays `"private": true` — the bundler emits the publishable manifest.
