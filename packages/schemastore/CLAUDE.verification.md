# Verification — @effected/schemastore

The beta-probed facts, the hardening budget and the test pins. Evidence only —
the rules that follow from it live in the parent.

**Parent:** [@effected/schemastore context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/schemastore.md`

## Verified against the beta (do not re-litigate from memory)

- `Schema.toJsonSchemaDocument(schema: Constraint, options?)` →
  `JsonSchema.Document<"draft-2020-12">` and `JsonSchema.toDocumentDraft07`
  exist as used (vendored source, `effect@4.0.0-beta.101`).
- The Draft-07 lowering rewrites `#/$defs` refs to `#/definitions` and, **since
  effect rc.112 (PR #7420, "Make JSON Schema dialect conversions preserve
  custom keywords"), copies unknown and custom keywords through as opaque
  values** — in place, on the node they were attached to, and across the tuple
  coordinate move. Before rc.112 it dropped everything outside a fixed
  copy-list, which is why the package carried a post-lowering re-graft
  (`AnnotationCarriers`, deleted) *and* leaned on that drop as its enforcement
  of the declared-family narrowing. Both are gone: the narrowing is now the
  package's own gate (`UndeclaredAnnotationKeyError`).
  `__test__/annotation-carrying.test.ts` pins the lowering's behavior directly,
  per case, with no package code in the assertion path — re-read it before
  believing any claim about what the lowering does.
- Annotation keys land **exactly on the corresponding 2020-12 node** for every
  attachment site core generates (struct fields, struct roots, `$defs` pool
  entries, `prefixItems[i]`, `optionalKey`-wrapped fields, `allOf[i]` for
  check-then-annotate) — probed at beta.101, and re-probed at rc.112 for the
  attachment sites `annotation-carrying.test.ts` pins. The exception: an
  annotation on a hoisted schema's *usage* site reaches nothing.
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
Three recursive surfaces are capped:

1. The `$ref` rewrite — fails typed via `SchemaConversionError`.
2. The lint walk — degrades to a `DepthExceeded` finding, so the lint stays
   total.
3. The canonical emitter — fails typed `JsonDepthExceededError`, which also
   intercepts cycles.

`DocumentDiff`'s leaf comparison deliberately uses a looser stack guard: sharing
one budget made a deep-but-identical document compare as different.

## Test pins and killed mutants

Unit tests run over `FileSystem.layerNoop` + `Path.layer`; `SchemaFile`'s real
IO is tested under `integration/*.int.test.ts` over `@effect/platform-node`.
The contract-gate tests (`schema-pipeline.test.ts`) are the one exception:
they need **pre-existing content** on disk to classify a real predecessor, so
they run over `@effected/memfs`'s `MemoryFileSystem.layerWith` /
`layerInspectableWith` seeded with the predecessor text, not a hand-rolled
recording stub — a `layerNoop` double is deny-by-default and would have to
fabricate the read path this suite exists to exercise.

**The memfs `Volume` hazard the implementer hit:** `layerInspectableWith`
RE-SEEDS on every build. Resolving `MemoryFileSystem.Volume` under a SECOND
`Effect.provide` of the same layer value observes a FRESH volume holding the
seed, not the one the program under test wrote to — so a "nothing was
written" read-back passes vacuously, having never looked at the real volume.
The fix: resolve `Volume` INSIDE the same program the layer is provided to,
never via a second `Effect.provide`. Caught by the corrupted-file repair
case, the one assertion in the suite a fresh volume cannot satisfy.

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
always-write, layerTest-answers-instead-of-dying, and registry drift (dropping
`x-tombi-` broke the keyword-families, document-lint AND annotation-carrying
suites at once). Two phase-2 mutants died with `AnnotationCarriers` —
wrong-pointer graft and graft-all-`x-` keys — and were replaced by the
rc.112 pair: neutering the undeclared-key gate (`undeclared.size > 0`) and
letting the `$ref` rewrite descend into declared-family values, which kill
3 of `annotation-carrying.test.ts`'s 19 between them.

Phase 3 (#556/#599), discriminating pins the implementers reported:

- Contract guard never applies (i.e. `contractGuardApplies` hard-coded
  `false`) → 8 failures.
- `run` collapsed back to one pass (write-as-you-go instead of two-phase) → 9
  failures.
- `SchemaVersioning.isPinned` hard-coded `true` → 5 failures.
- `SchemaVersioning.next` always bumps MAJOR (no 0.x arm) → 1 failure.
