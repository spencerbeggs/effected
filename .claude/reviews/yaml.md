# Review: yaml-effect → @effected/yaml

Reviewed: `/Users/spencer/workspaces/spencerbeggs/yaml-effect` (v0.7.1, Effect v3) against
`.claude/design/effected/effect-standards.md`. Scope: design review for a v4-first redesign,
not a v3-idiom audit.

Scale of the port: ~14,200 lines of src (`composer.ts` alone is 4,967 lines), 25 unit/e2e test
files, plus a vendored yaml-test-suite fixture corpus with a 100% compliance harness
(1,226/1,226 assertions across parse, JSON-equivalence, canonical-output byte-equality, and
roundtrip families).

---

## 1. What is done well (preserve these)

**The compliance harness is the crown jewel.** `__test__/yaml-test-suite.e2e.test.ts` plus the
vendored fixture corpus proves spec correctness across four assertion families. Whatever the API
becomes, this harness must port intact — it is the regression safety net that makes an aggressive
redesign feasible at all.

**"Schema IS the class" is already the philosophy.** Every AST node (`YamlScalar`, `YamlMap`,
`YamlSeq`, `YamlPair`, `YamlAlias`) is a `Schema.TaggedClass`; `YamlDocument`, `YamlToken`,
`CstNode`, `YamlErrorDetail`, and all option bags are `Schema.Class`. The v4 migration is
therefore *additive* for the data model — attach static/instance methods to classes that already
exist — not a remodel. Mutual recursion is handled correctly with `Schema.suspend` and a single
co-located file (`YamlAstNodes.ts`) to break import cycles; that co-location argument carries
straight into the module-per-concept layout.

**Layered pipeline with every layer public.** lex → CST (`parseCST`) → compose
(`parseDocument`) → value (`parse`), with `composeDocumentFromCst` as the explicit seam between
CST and AST. This is the vscode `jsonc-parser` architecture generalized to YAML, and it is what
makes the library useful for tooling (LSP servers, formatters, linters) rather than just
config loading. Keep all four layers public.

**Structured diagnostics.** `YamlErrorDetail` (Schema.Class: `code`, `message`, `offset`,
`length`, `line`, `column`) with per-stage literal code unions (`YamlLexErrorCode`,
`YamlParseErrorCode`, `YamlComposerErrorCode`) is exactly the serializable, schema-backed error
payload `Schema.TaggedErrorClass` wants as a field. Warnings-as-data on `YamlDocument`
(`errors`/`warnings` arrays for non-fatal issues) alongside typed failure for fatal ones is a
good recoverable-parse design.

**Edit-based non-destructive editing.** `format`/`modify` return `YamlEdit[]` diffs (LSP
`TextEdit` semantics) with `applyEdits` separate, plus `*AndApply` one-shots and range-restricted
formatting. This is the library's real differentiator over `yaml` and must survive.

**Schema integration is the right DX.** `YamlFromString` /
`makeYamlSchema(S)` compose YAML decoding directly into a `Schema.Schema<A, string, R>`, with
line/column enriched `ParseResult` messages. This is the single best consumer-facing feature and
maps cleanly onto v4 `Schema.decodeTo` transformation chains.

**Other keepers:** lazy `Stream`-based visitors (`visit`, `visitCST`) safe under `Stream.take`;
`visitCollect` with `Option`-filtering predicates; `maxAliasCount` DoS protection; the pull-based
`createScanner` for incremental/LSP use; semantic `equals`/`equalsValue`; exhaustive TSDoc with
runnable examples and a full `docs/` set; zero runtime deps beyond `effect`.

---

## 2. What is confusing or awkward

**Kind-based folder sprawl — the exact anti-pattern the standards supersede.** `src/errors/`
(9 files), `src/schemas/` (10 files), `src/utils/` (11 files). Worse, `utils/` is a misnomer:
it holds the entire 12k-line engine (lexer, parser, composer, stringifier) *and* the public API
functions. `composer.ts` is a 4,967-line monolith mixing private composition machinery with the
four top-level public parse functions.

**Floating-function API surface.** ~45 top-level exports of loose functions
(`parse`, `parseDocument`, `parseAllDocuments`, `stringify`, `stringifyDocument`, `format`,
`formatAndApply`, `modify`, `modifyAndApply`, `applyEdits`, `stripComments`, `equals`,
`equalsValue`, `findNode`, `findNodeAtOffset`, `getNodePath`, `getNodeValue`, `visit`,
`visitCollect`, `visitCST`, `visitCSTCollect`, `lex`, `parseCST`, `makeYaml*` × 4, 11 `is*` AST
guards, 24 `is*Event` guards…). This is precisely what the class-based DX north star eliminates.

**Half the error ladder is dead code.** Eight error classes are exported; only four are ever
constructed: `YamlComposerError` (4 sites), `YamlFormatError` (6), `YamlModificationError` (3),
`YamlStringifyError` (2). `YamlLexError`, `YamlParseError`, `YamlNodeNotFoundError`, and
`YamlSchemaError` are never raised anywhere in `src/`. Most misleading: the user-facing parse
failure is named `YamlComposerError` (an internal pipeline-stage name) while a `YamlParseError`
exists, is exported, is documented as "parseCST may fail with this error" — and `parseCST`
actually returns `Stream<CstNode, never>`. Consumers must discover that "parse failed" means
`catchTag("YamlComposerError", …)`.

**The `*Base` error export hack.** Every error ships a companion `YamlXErrorBase` export (a
`Data.TaggedError` factory) purely to appease api-extractor `.d.ts` rollup, doubling the public
error surface with `@internal`-but-exported symbols.

**Duplicate `getNodeValue`.** `utils/ast.ts` exports `getNodeValue(node): Effect<unknown>`
(no alias resolution) and `utils/composer.ts` exports `getNodeValue(node, anchors?): unknown`
(sync, alias-resolving). Same name, different signatures and semantics; only the ast one reaches
`index.ts`, but both are importable from module paths.

**Fatal-error code lists copy-pasted three times.** `parseDocument`, `parseAllDocuments`, and
`composeDocumentFromCst` each inline a hardcoded `e.code === "UndefinedAlias" || …` filter —
and the three lists *differ slightly* (`MalformedFlowCollection` and `TabIndentation` presence
varies). This is drift waiting to happen; fatality should be a property of the code, declared
once.

**Options-type proliferation.** `YamlFormattingOptions` (Schema.Class) duplicates all seven
`YamlStringifyOptions` fields by hand (acknowledged `Schema.extend` workaround), then
`RawFormatOptions` (plain interface) mirrors `YamlFormattingOptions` *again* because the
Schema.Class `range` field demands a `YamlRange` instance. Three near-identical shapes for one
concept. `stringify` separately accepts
`YamlStringifyOptions | Partial<ConstructorParameters<…>[0]>` — an awkward union that leaks
constructor mechanics into a signature.

**Guard-function boilerplate.** 24 `is*Event` type guards (11 AST + 13 CST) that are each one
line of `_tag` comparison, plus 11 AST/`instanceof` guards. The unions are already
tag-discriminated Schema unions; `_tag` narrowing, `Schema.is`, or statics on the classes make
almost all of these redundant exports.

**Effect-wrapping of pure lookups.** `findNode`, `findNodeAtOffset`, `getNodePath`,
`applyEdits` are pure, total computations wrapped in `Effect.sync`, yielding
`Effect<Option<YamlNode>>` — consumers pay `yield*` + `Option` handling for what should be a
plain method returning `Option` (or the value). The `Fn.dual` dual-signature machinery on these
compounds the ceremony; as instance methods, dual style is moot.

**Structure-losing error wrapping.** `format`/`modify`/`stringify` collapse rich upstream
failures into `reason: string` (`new YamlFormatError({ text, reason: e.message })`), discarding
`YamlErrorDetail` positions and violating the "never collapse errors to string early" rule.

**Tests are v3-era plain vitest.** All 25 test files use `describe/it` + `Effect.runSync`;
zero `@effect/vitest` / `it.effect` usage. Fine for v3, but the whole suite needs mechanical
conversion to the `it.effect` standard (the compliance harness especially).

**Verbose naming.** `makeYamlAllFromString`, `makeYamlDocumentSchema`, `visitCSTCollect`,
`formatAndApply`/`modifyAndApply` — factory-prefix and suffix disambiguation that class statics
absorb naturally (`Yaml.schemaAll()`, `YamlDocument.schema()`, `Yaml.format(…, { apply: true })`
or `formatText` vs `formatEdits`).

---

## 3. v4 migration implications (specific to this codebase)

| v3 construct (as used here) | v4 target |
| --- | --- |
| `Schema.TaggedClass<X>()("X", fields)` (AST nodes, 26 visitor events) | `Schema.TaggedClass` equivalents in v4 schema; construct via `X.make(...)` never `new X(...)` (touches every `new YamlScalar({...})` — hundreds of sites in composer/stringify/tests) |
| `Schema.Class<X>("X")(fields)` (Document, Token, CstNode, ErrorDetail, options) | Same, `Schema.Class` + `.make`; options defaults move from `Schema.optionalWith(…, { default })` to v4 `Schema.optionalKey` + decoding-default combinators |
| `Data.TaggedError("X")` + `*Base` api-extractor hack + `get message()` | `Schema.TaggedErrorClass` — kills the `*Base` hack outright; error fields (`errors: Schema.Array(YamlErrorDetail)`, `text`) become schema fields, errors become serializable for free (YamlErrorDetail already is a Schema.Class, so payloads port unchanged) |
| `Schema.transformOrFail(Schema.String, Schema.Unknown, { decode, encode })` + `new ParseResult.Type(ast, input, msg)` (schema-integration.ts) | v4 `Schema.decodeTo` with transformation; issue construction via v4 issue types; keep the line/column message enrichment. The two `as unknown as Schema.Schema<…>` casts in `makeYamlAllFromString`/`makeYamlDocumentSchema` should die in the redesign |
| `Schema.compose(yamlSchema, targetSchema, { strict: false })` (`makeYamlSchema`) | v4 pipe-composition of codecs; the `R`-polymorphic signature `Schema.Schema<A, string, R>` should be preserved — it is good design |
| `Schema.Schema.Type<typeof X>` | `typeof X.Type` |
| `Schema.Literal(...)` code/kind/style unions | Unchanged conceptually; consider `Schema.Literals` v4 form |
| `Schema.suspend` recursive AST | Unchanged |
| `Fn.dual` dual signatures (`findNode`, `equals`, `modify`, `applyEdits`) | Dropped — these become instance/static methods on the schema classes; data-first only |
| `Stream.fromEffect/fromIterable/filterMap/runCollect` (visitors, lexer, parser) | v4 stream module (import paths change; API largely parallel). Visitor/lexer/CST streams stay streams |
| `Context.Tag` / `Effect.Service` | **N/A — the library defines zero services.** No `Context`, no `Layer` anywhere in `src/`. Nothing to convert; the v4 design question is whether to *introduce* a service, and the answer should be no for a pure library (class statics suffice; config-file-effect-style codec adapters are the consumer's layer) |
| `@effect/platform` | Not used (correctly — no IO) |
| Plain `describe/it` + `Effect.runSync` tests | `@effect/vitest` `it.effect`; shared fixtures via top-level `layer(...)` where applicable; add `it.effect.prop` roundtrip properties from `Schema.toArbitrary` on the AST classes |
| No `Effect.fn` / spans / logs anywhere | Wrap the public operations (`parse`, `stringify`, `format`, `modify`, `equals`) in `Effect.fn("Yaml.parse")` etc. per observability standard; internals stay untraced (hot paths — the composer is recursive; do NOT `Effect.fn` per-node) |

Additional v4 design moves enabled by the migration:

- **Field-level derivation for options**: derive `YamlFormatOptions` from `YamlStringifyOptions`
  via `pick`/`extend`-style v4 combinators instead of hand-duplicating seven fields; make
  `range` accept a plain `{ offset, length }` via the schema so `RawFormatOptions` can be
  deleted.
- **`SchemaError` normalization**: `makeYamlSchema` consumers currently get `ParseError`;
  under v4, normalize to domain errors at the boundary per the standard.
- **Error consolidation** (see §4): rename `YamlComposerError` → `YamlParseError` (the dead
  class of that name frees the good name), delete the four never-raised classes, keep
  stage-discrimination in `YamlErrorDetail.code`.

**Effort note:** the mechanical surface (schemas, errors, options, tests) is a few days; the
risk is the engine internals (`composer.ts`/`lexer.ts`/`stringify.ts` build AST nodes with `new`
constructors and plain-object state everywhere). Since these become `src/internal/`, port them
as-is first, verify the compliance suite, then refactor construction sites incrementally.

---

## 4. Candidate module-per-concept layout

```text
src/
  index.ts               # re-exports only
  Yaml.ts                # top-level facade concept:
                         #   Yaml.parse / Yaml.parseAll (value-level), Yaml.stringify,
                         #   Yaml.equals / Yaml.equalsValue,
                         #   Yaml.fromString / Yaml.schema(S) / Yaml.allFromString  (schema codecs)
                         #   YamlParseOptions, YamlStringifyOptions
                         #   YamlParseError (renamed from YamlComposerError), YamlStringifyError
  YamlDiagnostic.ts      # YamlErrorDetail renamed to what it is (used for errors AND warnings):
                         #   YamlDiagnostic class, staged code literals, fatal-code predicate
                         #   (single source of truth for the thrice-duplicated fatal lists)
  YamlNode.ts            # the AST concept (mutually recursive — one file, as today):
                         #   YamlScalar, YamlMap, YamlSeq, YamlPair, YamlAlias, YamlNode union,
                         #   ScalarStyle, CollectionStyle
                         #   instance methods: .find(path) => Option, .findAtOffset(o), .pathOf(n),
                         #   .toValue(anchors?), statics: YamlScalar.is(...) etc. (replaces guards)
  YamlDocument.ts        # YamlDocument, YamlDirective
                         #   statics: YamlDocument.parse(text, opts), .parseAll, .fromCst(cst, text),
                         #            YamlDocument.schema(opts)   (replaces makeYamlDocumentSchema)
                         #   instance: .stringify(opts), .toValue()
  YamlEdit.ts            # text-edit concept: YamlEdit, YamlRange, YamlPath type
                         #   static YamlEdit.apply(text, edits)  (replaces applyEdits)
  YamlFormat.ts          # formatting/modification concept:
                         #   YamlFormatOptions (derived from YamlStringifyOptions fields + range,
                         #   preserveComments); format (edits) / formatText, modify / modifyText,
                         #   stripComments; YamlFormatError, YamlModificationError
  YamlVisitor.ts         # AST event concept: 11 event classes + YamlVisitorEvent union,
                         #   visit(text, opts): Stream, collect(text, f)
  YamlCst.ts             # CST concept: CstNode, CstNodeType, parse (stream of CstNode),
                         #   CST visitor events + visit/collect (merges parser.ts public API,
                         #   YamlCstVisitorEvent.ts, cst-visitor.ts)
  YamlToken.ts           # lexical concept: YamlToken, YamlTokenKind, lex(text): Stream,
                         #   YamlScanner interface + YamlToken.scanner(text) pull-scanner
  internal/
    lexer.ts             # scanner state machine (from utils/lexer.ts)
    cst-parser.ts        # CST builder (from utils/parser.ts)
    composer/            # split the 4,967-line monolith along its existing internal seams:
      state.ts           #   createState, error recording, fatality filtering
      block.ts flow.ts scalars.ts tags.ts anchors.ts document.ts
    stringifier.ts       # emit engine incl. canonical-output logic (from utils/stringify.ts)
    fold.ts              # block/flow scalar folding helpers
    diff.ts              # computeEdits text diffing (shared by format + modify)
    equal.ts             # deepEqual
```

Deleted concepts: `errors/` and `schemas/` directories, all `*Base` exports, dead
`YamlLexError`/`YamlNodeNotFoundError`/`YamlSchemaError`, `RawFormatOptions`, 24 event guard
functions, `makeYaml*` factory quartet, the duplicate composer-level `getNodeValue`/
`buildAnchorMap` (fold into `YamlNode.toValue` / internal).

Open naming question for the design doc: whether the facade is a `Yaml` class-with-statics or a
namespace re-export (`import { Yaml } from "@effected/yaml"`); semver-effect precedent says
class-with-statics.

---

## 5. Extraction / split / seam candidates and sibling overlap

**jsonc-effect is a near-isomorph.** Its export surface (`parse`, `format`, `modify`,
`applyEdits`, `equals`/`equalsValue`, `findNode`/`findNodeAtOffset`/`getNodePath`/`getNodeValue`,
`visit`/`visitCollect`, `createScanner`, `JsoncFromString`/`makeJsoncSchema`, `JsoncEdit`,
`JsoncRange`, `JsoncFormattingOptions`, `JsoncToken`) matches yaml-effect one-for-one. Three
options, in preference order:

1. **API-contract parity, no shared code** (recommended initially): both packages implement the
   same concept names and method shapes (`Edit`, `Range`, `Path`, `X.find`, `X.schema(S)`,
   edits-vs-text formatting pairs). Zero coupling; the standards doc becomes the contract.
2. **Extract a micro-kernel** `@effected/text-edit` (pure tier): `Edit`, `Range`, `Path`,
   `Edit.apply`, and the `computeEdits` line-diff — the only genuinely duplicated *logic* (the
   diffing algorithm) between the two. Small, stable, worth doing once both packages are in-repo
   and the duplication is observable.
3. Do NOT extract visitor/AST abstractions — YAML and JSONC trees differ enough (anchors,
   aliases, pairs-vs-properties, multi-document) that a shared tree abstraction would be
   premature and leaky.

**config-file-effect is the consumer seam.** Its `ConfigCodec` interface
(`{ name, extensions, parse: (raw) => Effect<unknown, CodecError>, stringify }`) is exactly the
`Yaml` facade shape, and it currently ships `JsonCodec`/`TomlCodec` but **no YAML codec**.
`@effected/yaml`'s design should make a one-file `YamlCodec` adapter trivial for
`@effected/config-file` (pure→pure dependency, `workspace:*`). Do not put the codec in
`@effected/yaml` itself — keep the dependency arrow pointing at yaml, not from it.

**package-json-effect** overlaps only in house patterns (it has the same kind-based `errors/`/
`layers/` sprawl to fix), not in function — it is JSON-domain. No seam.

**Internal split within @effected/yaml itself:** no package split warranted. The CST/scanner
layer is conceivably a separate "yaml-cst" package for LSP tooling, but there is no consumer
demanding it; keep one package, keep the layers as modules. Revisit only if a language-server
project materializes.

**Doc corpus:** the `docs/*.md` set (11 topic guides) and the README's honest "use `yaml` unless
you need X" framing are worth porting nearly verbatim into the monorepo website.

---

## 6. Peer/dependency hygiene — tier verification

**Pure tier: CONFIRMED.**

- `peerDependencies`: `effect` only (`catalog:silkPeers`), `peerDependenciesMeta` marks it
  non-optional. No `@effect/platform*`, no `@effect/*` subpackages anywhere.
- Runtime imports in `src/`: **only** `"effect"` (verified: no `node:` builtins, no third-party
  modules, no `@effect/platform`). Zero IO — the library takes strings in and produces
  strings/values out; even the visitor streams are pure.
- `dependencies`: none. `devDependencies` are toolchain-only (`@savvy-web/*`, vitest agent,
  tsgo, `effect` for tests).
- Peer-closure completeness (the systems#228 / vitest-agent#127 lesson): trivially satisfied —
  `effect` itself has no peers, so declaring `effect` alone IS the complete closure. No
  unfulfilled transitive peers can escape to consumers.

Migration deltas for the monorepo `package.json`:

- Rename to `@effected/yaml`; peer moves to the v4 effect catalog range.
- Keep `sideEffects: false`; keep zero runtime deps.
- Add `@effect/vitest` (v4-compatible) to devDependencies for the `it.effect` test conversion.
- The vendored `__test__/fixtures/yaml-test-suite` corpus (a git checkout with its own `.git`)
  needs a monorepo-friendly vendoring strategy (subtree, tarball fixture, or fetch-on-test
  script) — decide before port, since Turbo cache inputs and repo size are affected.
- If option 2 in §5 is taken later, `@effected/text-edit` enters as `workspace:*`; edge type
  (peer vs regular) decided at design time per standards.
