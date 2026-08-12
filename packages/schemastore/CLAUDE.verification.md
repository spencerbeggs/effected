# Verification — @effected/schemastore

The beta-probed facts, the hardening budget and the test pins. Evidence only —
the rules that follow from it live in the parent.

**Parent:** [@effected/schemastore context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/schemastore.md`

## Verified against the beta (do not re-litigate from memory)

- `Schema.toJsonSchemaDocument(schema: Constraint, options?)` →
  `JsonSchema.Document<"draft-2020-12">` and `JsonSchema.toDocumentDraft07`
  exist as used (vendored source, `effect@4.0.0-beta.101`).
- The Draft-07 lowering rewrites `#/$defs` refs to `#/definitions` AND **drops
  every keyword outside its fixed copy-list** — probed:
  `includeAnnotationKey`-admitted keys (`x-taplo`, `markdownDescription`, …)
  survive at 2020-12 and vanish after lowering. That is why the annotation
  carriers re-graft *after* the lowering rather than riding
  `ToJsonSchemaOptions` alone. `additionalProperties` and descriptions do
  survive.
- Annotation keys land **exactly on the corresponding 2020-12 node** for every
  attachment site core generates (struct fields, struct roots, `$defs` pool
  entries, `prefixItems[i]`, `optionalKey`-wrapped fields, `allOf[i]` for
  check-then-annotate) — probed at beta.101. That determinism is what makes the
  parallel-walk re-graft sound. The exception: an annotation on a hoisted
  schema's *usage* site reaches nothing.
- Core's `Schema.Annotations.Annotations` carries an index signature
  (`readonly [x: string]: unknown`), so
  `Schema.String.annotate({ "x-taplo": {...} })` type-checks without module
  augmentation.
- Core's generator is total over `Schema.declare` (it emits `{"type":"null"}`
  rather than throwing), so `SchemaConversionError`'s fireable path in tests is
  the package's own rewrite depth cap.
- `DRAFT_07_META_SCHEMA` keeps the trailing `#` (SchemaStore corpus convention)
  where core's `JsonSchema.META_SCHEMA_URI_DRAFT_07` omits it — documented on
  the constant.

## Hardening

`internal/limits.ts` holds the kit parity constant `MAX_NESTING_DEPTH = 256`.
Four recursive surfaces are capped:

1. The `$ref` rewrite — fails typed via `SchemaConversionError`.
2. The carrier re-graft — fails typed `CarrierDepthExceededError`, folded into
   `SchemaConversionError.cause` inside `fromSchemaResult`.
3. The lint walk — degrades to a `DepthExceeded` finding, so the lint stays
   total.
4. The canonical emitter — fails typed `JsonDepthExceededError`, which also
   intercepts cycles.

`DocumentDiff`'s leaf comparison deliberately uses a looser stack guard: sharing
one budget made a deep-but-identical document compare as different.

## Test pins and killed mutants

Unit tests run over `FileSystem.layerNoop` + `Path.layer`; `SchemaFile`'s real
IO is tested under `integration/*.int.test.ts` over `@effect/platform-node`.

Discriminating pins:

- The `#/definitions` → `#/$defs` rewrite touches only `$ref` values (prose
  survives).
- Numeric-not-lexical version ordering (`1.10.0` > `1.9.0`).
- Keyword-position awareness: a property *named* `unevaluatedProperties` is not
  flagged; `enum`/`const`/`default`/`examples` are data positions.
- Firing plus clean-pass per lint check.
- Both catalog modes round-trip through the `CatalogEntry` codec.
- The tuple coordinate move (`prefixItems[i]` → `items[i]`).
- Non-declared keys are not carried even when the caller admits them.
- `"unchanged"` means the filesystem was not touched — a write-recording stub
  plus a pinned-mtime integration test.

Mutants run and killed — phase 1: rewrite-all-strings, lexical order,
properties-map-as-schema, dropped trailing newline, url-at-oldest. Phase 2:
wrong-pointer graft (`prefixItems`→`prefixItems`), graft-all-`x-` keys,
always-write, layerTest-answers-instead-of-dying, and registry drift (dropping
`x-tombi-` broke the keyword-families, document-lint AND annotation-carriers
suites at once).
