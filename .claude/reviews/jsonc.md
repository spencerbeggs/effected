# Review: jsonc-effect → @effected/jsonc

Reviewed: 2026-07-06. Source: `/Users/spencer/workspaces/spencerbeggs/jsonc-effect` (v0.3.0, Effect v3).
Target standards: `.claude/design/effected/effect-standards.md`. Provisional tier: **pure** — confirmed below.

## Scope of the library

A from-scratch JSONC toolchain with zero parser dependencies: scanner (lexer),
recursive-descent parser (value mode + AST mode), AST navigation, SAX-style
visitor as a lazy `Stream`, formatting/modification as computed edits, semantic
equality, and Schema integration (`JSONC string → validated domain type`).
~2,300 lines of source, 271 tests, exhaustive TSDoc. Known consumer:
`workspaces-effect` (uses `parse` for Bun workspace configs).

---

## 1. What is done well (preserve in the v4 redesign)

### Design decisions worth carrying forward verbatim

- **Zero runtime dependencies beyond `effect`.** Scanner and parser are ported
  from Microsoft's jsonc-parser design (MIT) rather than wrapping it. This is
  what makes the pure-tier assignment possible and is the package's identity.
- **String-literal token kinds and error codes** (`"OpenBrace"`, `"ValueExpected"`)
  instead of numeric enums. Self-documenting in logs, test assertions, and
  `Schema.Literal` pattern matching. Explicitly justified in TSDoc.
- **Edits-not-mutations model.** `format` and `modify` return `JsoncEdit[]`;
  `applyEdits` applies them in reverse-offset order. Byte-minimal edits preserve
  comments and surrounding whitespace — the core value proposition over
  `JSON.parse`/`JSON.stringify` round-trips. This is the best abstraction in the
  library.
- **AST without parent pointers.** Documented rationale: circular refs would
  break structural equality, serialization, and Schema encode/decode. Child
  navigation via `children` + `Schema.suspend` for recursion. Keep exactly.
- **Restrained error surface.** One aggregate `JsoncParseError` carrying an array
  of `JsoncParseErrorDetail` (a `Schema.Class` with code/message/offset/length/
  line/character), rather than one error class per parse-error code. Contrast
  with yaml-effect's nine error classes — jsonc-effect got this right.
  Error-recovery parsing (collect all errors, fail once) is also correct.
- **Schema integration as the flagship DX.** `JsoncFromString` /
  `makeJsoncFromString(options)` / `makeJsoncSchema(Target)` giving
  `Schema<A, string>` pipelines. This is the reason an Effect-native JSONC
  library exists; in v4 it becomes even more central.
- **`Option` for absence, `unknown` not `any`.** `parseTree` returns
  `Option<JsoncNode>`; `findNode` returns `Option`; `parse` returns `unknown`.
- **Lazy `Stream` visitor.** `visit` wraps a generator with
  `Stream.fromIterable` — demand-driven, supports `Stream.take` early
  termination on large documents. The event union with `path` context on
  Begin/Property/Literal events is well shaped.
- **Deliberate, documented defaults.** `allowTrailingComma: true` by default
  (deviating from MS parser), documented as intentional for the
  tsconfig/VS Code-settings use case.
- **Tight token-end offset discipline** (`tokenEnd()` captured before advancing
  past trivia, referencing issue #62 in comments) — node spans never swallow
  trailing whitespace/comments. Subtle correctness work; port the invariant and
  its regression tests.
- **TSDoc quality.** Every public symbol has remarks, examples, cross-links, and
  `privateRemarks` explaining non-obvious implementation choices. Keep this bar.

### Behavior contracts to preserve

- `equals`/`equalsValue` semantics: key-order independent for objects, order
  sensitive for arrays, comments/formatting ignored.
- `stripComments(text, replaceCh)` offset-preserving mode.
- `modify` value=`undefined` means delete (including comma handling);
  insertion appends after last property/element.

---

## 2. What is confusing or awkward (do not carry forward)

- **Fifteen floating functions.** `parse`, `parseTree`, `stripComments`,
  `findNode`, `findNodeAtOffset`, `getNodePath`, `getNodeValue`, `format`,
  `applyEdits`, `formatAndApply`, `modify`, `equals`, `equalsValue`, `visit`,
  `visitCollect`. The standards target is class-based statics/instance methods.
  Most of the `Function.dual` ceremony (and its awkward
  `(args: IArguments) => ...` arity predicate in `modify`) disappears when
  these become methods.
- **`*Base` error export pattern.** `JsoncParseErrorBase`,
  `JsoncNodeNotFoundErrorBase`, `JsoncModificationErrorBase` exist only as an
  api-extractor workaround for `Data.TaggedError`'s type complexity, yet are
  exported `@public`. Three extra public symbols of pure noise.
  `Schema.TaggedErrorClass` in v4 eliminates the need.
- **Dead error class.** `JsoncNodeNotFoundError` is exported, documented as
  "findNode — may fail with this error", and included in the `JsoncError`
  union — but nothing in `src/` ever raises it (`findNode` returns
  `Option.none()` instead, which is the better design). Docs/behavior mismatch;
  drop the error, keep the `Option`.
- **Two overlapping error-code vocabularies.** `JsoncScanError` (schemas.ts)
  and `JsoncParseErrorCode` (errors.ts) with a manual scan-error→parse-code
  mapping switch duplicated in BOTH `parse.ts#scanNext` and
  `visitor.ts#scanNext`. Unify the vocabulary or map once in one internal
  helper.
- **Two independent path-navigation implementations.** `findNode` walks the
  AST; `modify` re-implements navigation directly over the scanner (justified
  as avoiding AST allocation), including a self-admittedly fragile
  `lastIndexOf('"${segment}"')` backwards string search for property removal
  that breaks on keys containing quotes. In the redesign either share one
  navigation path or make the scanner-based navigator a properly tested
  internal module.
- **`parseInternal` dual-mode closure.** ~420 lines with a `buildTree` boolean
  producing either a value or a tree, plus near-duplicated
  `parseArray`/`parseArrayTree` and `parseObject`/`parseObjectTree` pairs and
  `MutableJsoncNode` casts. Consider parsing to the tree once and deriving the
  value via evaluation, or at least splitting the two modes into internal
  modules.
- **Effect wrappers on infallible pure functions.** `getNodeValue`,
  `applyEdits`, `format`, `stripComments`, `visitCollect` all return
  `Effect<A, never>` around fully synchronous, non-failing computation. Decide
  per API in the design doc: pure sync methods where nothing can fail, Effect
  only where the error channel is real (`parse`, `modify`, schema decode).
  Uniform-Effect-everywhere is defensible but should be a documented choice,
  not an accident.
- **Overload-object const signatures** for optional parameters
  (`export const parse: { (text): ...; (text, options): ... } = ...`) — verbose
  ceremony that class statics with a single optional parameter eliminate.
- **`visitCollect`** is a three-combinator convenience
  (`filter` + `runCollect` + `toReadonlyArray`); marginal API surface.
- **Hand-written `JsoncVisitorEvent` union.** Fine, but as plain object
  literals the events are neither Schema-backed nor `Data.TaggedEnum`; a v4
  Schema union would make events serializable and consistent with the rest of
  the library.
- **Scanner exported publicly.** `createScanner`/`JsoncScanner` is the mutable
  imperative engine. It is honest about being the only mutable part, but its
  public presence drags an un-Effect-like API onto the surface. In v4 it
  belongs in `src/internal/`; if token-level access is a real use case, expose
  a `Stream<JsoncToken>` tokenizer instead.
- **Testing.** One 2,037-line `src/index.test.ts` co-located in `src`, plain
  `it()` + `Effect.runPromise`/`runSync` throughout, zero `it.effect`. The
  monorepo standard is `@effect/vitest` `it.effect` in `__test__/`, split per
  concept. Also an opportunity for `it.effect.prop` property tests
  (round-trip: `applyEdits(format(x))` idempotent; `parse ∘ stripComments`
  agreement with `JSON.parse`).

---

## 3. v4 migration implications (this codebase specifically)

| v3 construct (here) | v4 construct |
| --- | --- |
| `Data.TaggedError("X")` + `*Base` workaround + `get message()` | `Schema.TaggedErrorClass` — serializable, yieldable, no Base export; message via field/annotation |
| `Schema.Class<X>("X")({...})` (JsoncToken, JsoncNode, JsoncEdit, JsoncRange, options classes) | `Schema.Class` (v4) — same concept; construct via `X.make(...)`, never `new X(...)` (tests currently use `new` everywhere) |
| `Schema.optional(...)` on `value`/`colonOffset`/`children` | `Schema.optionalKey` (fields are genuinely omitted, not `undefined`-valued) |
| `Schema.optionalWith(..., { default: () => ... })` on options classes | v4 constructor/decoding defaults on `optionalKey` fields |
| `Schema.suspend` for recursive `JsoncNode` | `Schema.suspend` (unchanged) |
| `Schema.Literal` unions + `Schema.Schema.Type<typeof X>` | `Schema.Literals` + `typeof X.Type` |
| `Schema.transformOrFail(String, Unknown, {decode/encode})` + `ParseResult.Type` (`JsoncFromString`) | v4 transformation (`Schema.String.pipe(Schema.decodeTo(...))`); wrap failures in the domain `JsoncParseError`, never leak raw schema issues (standards: normalize `SchemaError` at the boundary) |
| `Schema.compose(JsoncFromString, target)` (`makeJsoncSchema`) | v4 composition — keep as `Jsonc.schema(Target, options?)` static; this is the flagship API |
| `Function.dual` floating functions | Static/instance methods on schema classes; `dual` no longer needed |
| Anonymous `Effect.sync`/pipe bodies | `Effect.fn("Jsonc.parse")(...)` etc. for named spans on the public operations (parse, parseTree, modify, format); helpers stay untraced |
| `Stream.fromIterable(generator)` visitor | Same shape in v4 (verify Stream API drift at port time) |
| No services | Still none — pure tier needs no `Context.Service`; do not invent one |
| Plain `it()` + `runPromise`, tests in `src/` | `@effect/vitest` `it.effect`, tests in `__test__/`, split per concept |

Notes:

- No `@effect/platform` usage anywhere, so the v3→v4 platform merge is a
  non-event for this package.
- `Chunk`, `Option`, `Stream`, `ParseResult` usages are all `effect`-core; only
  `ParseResult` changes shape materially in v4.
- Structural equality of `Schema.Class` instances is load-bearing for tests
  (`Equal.equals` on tokens) — verify v4 `Schema.Class` equality semantics
  before porting assertions.

---

## 4. Candidate module-per-concept layout

```text
src/
  index.ts              # re-exports only
  Jsonc.ts              # Facade concept: static parse / parseTree / stripComments /
                        #   equals / equalsValue / schema(Target, opts) / fromString(opts).
                        #   Owns JsoncParseError, JsoncParseErrorDetail, JsoncParseErrorCode,
                        #   JsoncParseOptions. (Errors live with the concept that raises them.)
  JsoncNode.ts          # Schema.Class AST node (recursive via suspend) + instance methods:
                        #   find(path), findAtOffset(offset), pathAt(offset), toValue().
                        #   Owns JsoncNodeType. Absence stays Option — no NotFound error.
  JsoncEdit.ts          # Schema.Class edit + static applyAll(text, edits).
                        #   Owns JsoncRange, JsoncFormattingOptions.
  JsoncFormatter.ts     # format(text, range?, opts?) -> edits; formatToString convenience.
                        #   (Or fold into Jsonc.ts as statics if surface stays small.)
  JsoncModifier.ts      # modify(text, path, value, opts?) -> edits.
                        #   Owns JsoncModificationError.
  JsoncVisitor.ts       # Schema-backed event union + visit(text, opts?) -> Stream<Event>.
  internal/
    scanner.ts          # mutable scanner engine (currently public createScanner/JsoncScanner)
    parser.ts           # recursive descent (parseInternal), error-code mapping (single copy)
    navigate.ts         # shared scanner-based path navigation used by modifier
```

Naming judgement calls for the design doc:

- Keep the `Jsonc` prefix on schema classes (`JsoncNode`, `JsoncEdit`) — the
  names are the API and `Node`/`Edit` are too generic to import unprefixed.
- `formatAndApply` → drop; `Jsonc.format` returning edits plus
  `JsoncEdit.applyAll` covers it, or keep one `formatToString` convenience.
- `visitCollect` → drop (Stream combinators suffice).
- `JsoncPath`/`JsoncSegment` stay small type aliases co-located with
  `JsoncNode` (or a shared package — see below).
- `JsoncToken`/`JsoncSyntaxKind`/`JsoncScanError` move internal unless a
  `Stream<JsoncToken>` tokenizer is deemed a public feature.

---

## 5. Extraction / split / seam candidates; sibling overlap

- **yaml-effect is a structural clone of this API** (its `errors/`, `schemas/`,
  `utils/` mirror jsonc-effect: `YamlEdit`≈`JsoncEdit`, `YamlRange`≈`JsoncRange`,
  `YamlPath`≈`JsoncPath`, `Yaml*Error` ladder with the same `*Base` workaround,
  `equality.ts`, `format.ts`, `visitor.ts`, `schema-integration.ts`). The shared
  vocabulary — Edit, Range, Path/Segment, FormattingOptions,
  error-detail-with-position, `applyEdits`, `equals`/`equalsValue`,
  string→domain schema factory — is a genuine extraction candidate: either a
  tiny shared pure package (e.g. `@effected/text-edit` or `@effected/document`)
  or, more conservatively, a written convention that both packages implement
  identical shapes so consumers can write codec-generic code. Decide before
  porting the second parser, not after.
- **config-file-effect's `JsonCodec` uses raw `JSON.parse`** — it cannot read
  commented config today. Obvious seam: `@effected/config-file` gains a
  `JsoncCodec` backed by `@effected/jsonc` (`Jsonc.schema` slots directly into
  its codec `parse`/`stringify` interface). This likely makes @effected/jsonc a
  `workspace:*` dependency of the config-file port.
- **workspaces-effect** already consumes `parse` for Bun workspace JSONC —
  second confirmed consumer; its usage (`parse` → Schema validation) is exactly
  the `Jsonc.schema` pipeline, so the port can simplify that call site.
- **package-json-effect**: no overlap (package.json is strict JSON); no edge.
- **Internal seams:** scanner→parser→(value|tree) and scanner→visitor are clean
  layers already; the one blemish is the duplicated scan-error mapping and the
  second navigation implementation in `modify` (see §2). The visitor could in
  principle be a subpath export if bundle size ever matters, but it is small.

---

## 6. Peer / dependency hygiene — pure tier CONFIRMED

- `peerDependencies`: `effect` only (`catalog:silkPeers`). No runtime
  `dependencies` at all. Dev deps (`@savvy-web/*`, vitest tooling, `effect` for
  development) are irrelevant to consumers.
- No `@effect/platform*` imports, no `node:` imports, no IO of any kind in
  `src/` — all inputs are strings, all outputs are values/edits/streams.
  **Pure-tier assignment is correct.**
- Peer closure is complete trivially: `effect` itself has no peers, so there
  are no undeclared transitive peers to escape to the consumer (the
  systems#228 / vitest-agent#127 failure mode cannot occur here).
- For `@effected/jsonc`: peer on `effect` (v4 range) only; `@effect/vitest` as
  dev dep for testing. Nothing else needed.

---

## Flagged for the design doc

1. Effect-wrapping policy for infallible operations (uniform Effect vs pure
   sync methods) — decide once, document, apply everywhere.
2. Public or internal scanner (and if public, token `Stream` vs imperative
   interface).
3. Shared document-toolkit extraction with yaml-effect — decide before the
   second parser ports.
4. Whether `JsoncFromString`-style default-options singletons survive, or
   everything routes through `Jsonc.schema`/`Jsonc.fromString` factories
   (watch layer/schema memoization-by-reference implications for the factory
   forms).
