---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-07-07
last-synced: 2026-07-07
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - semver.md
---

# @effected/jsonc design

## Overview

Target design for `@effected/jsonc`, the second package migration (step 2 of [migration-playbook.md](../migration-playbook.md), playbook target #2 after semver). Source is jsonc-effect (`/Users/spencer/workspaces/spencerbeggs/jsonc-effect`, v0.3.0, Effect v3); the step-1 analysis lives in `.claude/reviews/jsonc.md` and this design implements its §3 v4-mapping, §4 layout, §5 seams and §6 dependency findings against [effect-standards.md](../effect-standards.md). Like the semver port this is a redesign, not a lift-and-shift: the zero-dependency scanner/parser core, the edits-not-mutations model, the parent-pointer-free AST, the aggregate-error design and the string→domain schema DX all survive; the fifteen floating functions, the public `*Base` ceremony, the dead `JsoncNodeNotFoundError`, the duplicated scan-error mapping and the fragile string-search navigation do not.

Status: **implemented on `feat/jsonc-migration` (playbook steps 2–6 complete).** The four review-flagged decisions were resolved (recorded below with rationale), the carry-forward learnings from the semver migration are baked in as house policy, and the port landed with all gates green (62/62 tests, typecheck, biome, zero-warning `dist/prod/issues.json`). This doc records the *as-built* design; per the semver precedent it is promoted to `current` with a raised completeness and inline "As-built:" deviation notes woven into the sections below. `@effected/jsonc` is also the reference template for the `@effected/yaml` port that follows it — the parity convention in [jsonc/yaml parity](#jsoncyaml-parity-convention) is a migration requirement, not a nicety.

## Tier and dependencies

Pure tier — no IO anywhere, confirmed by review §6. All inputs are strings; all outputs are values, edits, streams or domain errors. `peerDependencies`: `effect` only (`catalog:effect`). `devDependencies`: `effect` and `@effect/vitest` (both `catalog:effect`). Peer closure is trivially complete: `effect` has no peers of its own, so the systems#228 / vitest-agent#127 escape mode cannot occur here. No `@effect/platform*` imports, no `node:` imports — the v3→v4 platform merge is a non-event for this package. No cross-`@effected` edges outbound; `@effected/config-file` and `@effected/workspaces` will later depend on this package (via `workspace:*`), not the reverse (review §5). `"sideEffects": false`. Target directory is `packages/jsonc`.

## Module layout (module-per-concept)

Per the module-per-concept standard, ~9 source files replacing the v3 repo's kind-based layout and its single 2,037-line co-located test file (review §4):

- `src/index.ts` — public surface, re-exports only, zero side effects.
- `src/Jsonc.ts` — the facade concept. Statics `parse`, `parseTree`, `stripComments`, `equals`, `equalsValue`, and the flagship schema factories `schema(Target, options?)` / `fromString(options?)` plus the `JsoncFromString` default-options schema. Owns `JsoncParseOptions`, `JsoncParseError`, `JsoncParseErrorDetail` and the `JsoncParseErrorCode` literal set.
- `src/JsoncNode.ts` — the recursive AST node (`Schema.Class` + `Schema.suspend`), no parent pointers. Instance methods `find(path)`, `findAtOffset(offset)`, `pathAt(offset)`, `toValue()`. Owns the `JsoncNodeType` literal set and the co-located `JsoncPath` / `JsoncSegment` type aliases. Absence stays `Option` — no `NotFound` error.
- `src/JsoncEdit.ts` — the `Schema.Class` edit plus static `applyAll(text, edits)`. Owns the shared edit vocabulary: `JsoncRange` and `JsoncFormattingOptions` (both consumed by the formatter and modifier).
- `src/JsoncFormatter.ts` — `format(text, range?, options?) -> ReadonlyArray<JsoncEdit>` and the `formatToString` convenience (`applyAll ∘ format`). References `JsoncFormattingOptions`/`JsoncRange` from `JsoncEdit.ts`.
- `src/JsoncModifier.ts` — `modify(text, path, value, options?) -> ReadonlyArray<JsoncEdit>`. Owns `JsoncModificationError`.
- `src/JsoncVisitor.ts` — the Schema-backed event union and `visit(text, options?) -> Stream<JsoncVisitorEvent>`.
- `src/internal/scanner.ts` — the mutable imperative scanner engine (v3's public `createScanner`/`JsoncScanner`), now private.
- `src/internal/parser.ts` — the recursive-descent parser (value mode + tree mode) and the single copy of the scan-error→parse-code mapping.
- `src/internal/navigate.ts` — the scanner-based path navigation the modifier uses, now a properly tested internal module.

Every non-entrypoint module imports explicitly from defining modules; no barrels, no re-export facades. `JsoncVisitor` is the only plausible future subpath-entry candidate (review §5) if bundle size ever matters — no split now.

A judgement call beyond the review: **`JsoncFormatter` is kept as its own module rather than folded into the `Jsonc` facade.** The review offered both; a standalone formatter keeps the facade small and — more importantly — makes the jsonc/yaml surfaces structurally symmetric (`YamlFormatter` will want the identical shape), which is the whole point of the parity convention. The formatting statics are pure and stateless, so this is purely an organizational choice with no runtime cost.

## Effect-wrapping policy (package-wide)

**Decision 1, resolved.** The review flagged v3's habit of wrapping infallible synchronous computation in `Effect<A, never>` (`getNodeValue`, `applyEdits`, `format`, `stripComments`, `visitCollect`). The resolved package-wide policy, which is also the template for `@effected/yaml`:

> **Pure synchronous methods where nothing can fail; `Effect` only where the error channel is real.**

- **Pure synchronous** (no `Effect`, no `Option` wrapping of the whole result unless absence is the value): node value extraction (`JsoncNode.toValue`), edit application (`JsoncEdit.applyAll`, `JsoncFormatter.formatToString`), formatting (`JsoncFormatter.format` — computing edits never fails), comment stripping (`Jsonc.stripComments`), and semantic equality (`Jsonc.equals` / `equalsValue`). These are total functions over their inputs; an `Effect<_, never>` wrapper is pure ceremony that forces callers into `runSync` for no benefit.
- **`Effect`** (real typed `E` channel): `Jsonc.parse` (`Effect<unknown, JsoncParseError>`), `Jsonc.parseTree` (`Effect<Option<JsoncNode>, JsoncParseError>`), `JsoncModifier.modify` (`Effect<ReadonlyArray<JsoncEdit>, JsoncModificationError>`), and the schema decode path (`Jsonc.schema` / `Jsonc.fromString` decoding, whose failures normalize into `JsoncParseError`).
- **`Stream`** for the visitor: `JsoncVisitor.visit` returns `Stream<JsoncVisitorEvent>`. Malformed input surfaces as error events *in the union* (mirroring v3's `onError` callback), keeping the stream demand-driven and infallible at the type level; `Stream.take` early-termination on large documents is preserved.

Uniform-Effect-everywhere was the defensible alternative the review named; it is rejected here because the pure/Effect split makes the fallible operations legible at the call site (an `Effect` return type *means* "this can produce a `JsoncParseError`") and keeps the flagship pure operations ergonomic.

As-built: `Jsonc.equals` / `equalsValue` are pure *total* booleans (as designed), but PR review hardened their semantics against a footgun: inputs with **any** parse errors now compare unequal (return `false`) rather than comparing the recovery parser's best-effort output. Malformed input is never equal to anything — this closes the hole where `{ bad }` compared equal to `{}`. The statics still run the recovery parser, but they short-circuit to `false` whenever either side produced parse errors, and only compare the recovered values when both sides parsed cleanly; they remain total with no error channel to surface. v3 instead returned `Effect<boolean, JsoncParseError>` and failed on malformed input.

## Target public API

Class-based DX throughout: the v3 fifteen floating functions collapse to statics and instance methods on the schema classes, and the `Function.dual` ceremony (including `modify`'s `(args: IArguments) => ...` arity predicate) disappears. The overload-object const signatures for optional parameters (`{ (text): ...; (text, options): ... }`) become single-optional-parameter class statics.

### Jsonc (facade)

Not a schema class — a namespace object of statics over the parser and schema layers.

- `parse(text, options?)` → `Effect<unknown, JsoncParseError>`. Error-recovery parsing: collect *all* parse-error details, fail once with the aggregate. Returns `unknown`, never `any` (review §1).
- `parseTree(text, options?)` → `Effect<Option<JsoncNode>, JsoncParseError>`. `Option.none()` for empty input; the aggregate error for malformed input.
- `stripComments(text, replaceCh?)` → `string`. Offset-preserving mode preserved (replace comment bytes with `replaceCh`, default space) — a behavior contract from review §1.
- `equals(a, b)` / `equalsValue(a, b)` → `boolean`. Key-order-independent for objects, order-sensitive for arrays, comments/formatting ignored (behavior contract, review §1).
- `schema(Target, options?)` and `fromString(options?)` and the `JsoncFromString` default-options schema — see [Schema transformation strategy](#schema-transformation-strategy).
- Owns `JsoncParseOptions` (`Schema.Class` with `allowTrailingComma` defaulting to `true` — the deliberate, documented tsconfig/VS-Code-settings default from review §1, carried over verbatim; `disallowComments`, `allowEmptyContent`).

As-built (both options classes): `JsoncParseOptions` and `JsoncFormattingOptions` model their fields as plain `Schema.optionalKey` and apply defaults at the *implementation* level (`options?.field ?? default`) rather than through v4 constructor/decoding-default wrappers. Every default contract from the design survives unchanged — including `allowTrailingComma = true` — but keeping the fields bare `optionalKey` keeps their `@public` base annotations tractable (the default-wrapper forms complicate the factory-return-type annotation the same way the self-referential node did). This applies equally to `JsoncFormattingOptions` in [JsoncEdit](#jsoncedit) below.

### JsoncNode

`Schema.Class` recursive AST node via `Schema.suspend`, no parent pointers (documented rationale from review §1: circular refs would break structural equality, serialization and Schema encode/decode). Fields per v3: `type` (`JsoncNodeType` literal — `object`/`array`/`property`/`string`/`number`/`boolean`/`null`), `offset`, `length`, `value` (`Schema.optionalKey` — genuinely omitted, not `undefined`-valued), `colonOffset` (`Schema.optionalKey`), `children` (`Schema.optionalKey` array). Construct via `JsoncNode.make(...)`, never `new JsoncNode(...)` (v3 tests use `new` everywhere).

- Instance: `find(path)` → `Option<JsoncNode>` (walks `children`, pure); `findAtOffset(offset)` → `Option<JsoncNode>`; `pathAt(offset)` → `Option<JsoncPath>`; `toValue()` → `unknown` (pure, per the wrapping policy). Absence is `Option`, never a `NotFound` error.
- The tight token-end offset discipline (review §1, issue #62 in v3 comments) — node spans never swallow trailing whitespace/comments — is a load-bearing invariant; port it *and* its regression tests.
- `JsoncPath` (`ReadonlyArray<JsoncSegment>`) and `JsoncSegment` (`string | number`) are small type aliases co-located here, bound by the parity convention below.

As-built: the recursive class got its `@public JsoncNode_base` const per the API-Extractor policy, but the factory-return-type annotation uses `Schema.Schema<JsoncNode>` for *both* the `Schema.suspend` callback return type and the self-referential `children` field type — the "copy the factory return type verbatim" rule the base skill states is impossible for a self-referential class. Annotating `children` with `typeof JsoncNode` is TS2506 (circularity: the class references itself through its own base's annotation), and `Schema.Codec<Self>`-style forms fail because the node's `Encoded` differs from its `Type`. `Schema.Schema<JsoncNode>` is the tractable form; the `effect-api-extractor-bases` skill has been updated with this self-referential-class idiom.

### JsoncEdit

`Schema.Class` holding `offset`, `length`, `content` (the shared edit vocabulary). Static `applyAll(text, edits)` → `string` applies in reverse-offset order (byte-minimal, comment/whitespace preserving — the core value proposition over `JSON.parse`/`stringify` round-trips, review §1). Owns `JsoncRange` (`Schema.Class`: `offset`, `length`) and `JsoncFormattingOptions` (`Schema.Class`: `tabSize`, `insertSpaces`, `eol`, `insertFinalNewline`, ... with v4 constructor/decoding defaults on `optionalKey` fields, replacing v3's `Schema.optionalWith(..., { default })`).

### JsoncFormatter

- `format(text, range?, options?)` → `ReadonlyArray<JsoncEdit>` (pure — computes edits, never fails).
- `formatToString(text, range?, options?)` → `string` (`applyAll ∘ format`). This is the sole survivor of v3's `formatAndApply` (which is otherwise dropped — `format` + `JsoncEdit.applyAll` covers the general case).

### JsoncModifier

- `modify(text, path, value, options?)` → `Effect<ReadonlyArray<JsoncEdit>, JsoncModificationError>`. `value === undefined` means delete (including comma handling); insertion appends after the last property/element (behavior contracts, review §1). Owns `JsoncModificationError`.
- Navigation goes through `internal/navigate.ts` — a properly tested scanner-based navigator that **replaces v3's self-admittedly fragile `lastIndexOf('"${segment}"')` backwards string search** (which broke on keys containing quotes, review §2). This is a correctness fix, not just a refactor: the navigator resolves segments through the scanner's structural tokens, never a raw substring match.

### JsoncVisitor

- `visit(text, options?)` → `Stream<JsoncVisitorEvent>`, wrapping the generator with `Stream.fromIterable` (demand-driven, `Stream.take`-friendly). The event union is **Schema-backed** in v4 (a `Schema.Union` of tagged events, or `Data.TaggedEnum`) rather than v3's plain object literals — making events serializable and consistent with the rest of the library (review §2). Begin/Property/Literal events carry `path` context; malformed-input error events are part of the union.
- `visitCollect` is **dropped** — `Stream.filter` + `Stream.runCollect` cover it (v4's `Stream.runCollect` returns an `Effect<Array<A>>` directly, so there is no `Chunk.toReadonlyArray` step), and the review rates the convenience marginal.

## Schema transformation strategy

**Decision 4, resolved.** The `JsoncFromString`-style default-options singleton survives *and* the factories are the flagship DX — mirroring semver's `SemVer.FromString` + factory-statics arrangement:

- `Jsonc.JsoncFromString` — a `Schema<unknown, string>` transformation (`Schema.String.pipe(Schema.decodeTo(...))`) using the parser with the *default* `JsoncParseOptions`. The zero-config entry point.
- `Jsonc.fromString(options?)` — a factory returning a `Schema<unknown, string>` bound to the supplied options; `JsoncFromString` is definitionally `Jsonc.fromString()` with defaults.
- `Jsonc.schema(Target, options?)` — composes `fromString(options)` with a target `Schema` (v4 composition), yielding the `Schema<A, string>` pipeline that is *the reason an Effect-native JSONC library exists* (review §1). `workspaces-effect`'s `parse → Schema.validate` call site collapses directly into this (review §5).

Decode is driven by the internal parser (value mode); encode is `JSON`-style stringification of the decoded value. Boundary discipline (standards): decode failures wrap into the domain `JsoncParseError` via `SchemaIssue.InvalidValue` — **`SchemaError` never escapes the package**, and no raw schema issues leak (`Effect.catchTag("SchemaError", ...)` at the boundary if the transformation surfaces one).

As-built: a `Schema` cannot fail with a domain error, so the boundary discipline lands exactly as in the semver precedent. The `Schema.decodeTo` transformation fails with a `SchemaError` carrying a `SchemaIssue.InvalidValue` whose message is the aggregate parse message; the *domain* `JsoncParseError` is constructed directly by the `parse` / `parseTree` path (which drives the internal parser and bypasses `Schema` entirely). Consumers that want the domain error from a schema pipeline normalize at the boundary with `Effect.catchTag("SchemaError", ...)` — the same shape semver ships. `SchemaError` still never escapes as the *documented* contract of `parse`/`parseTree`; it is only reachable through the raw schema decode path.

**Memoization-by-reference caveat (recorded per decision 4).** `Jsonc.fromString(options)` and `Jsonc.schema(Target, options)` are schema-*producing* functions, so each call returns a fresh schema instance — v4 schema derivation caches (`toArbitrary`, `toEquivalence`, decode-plan memoization) key by reference and will *not* be shared across calls with structurally-equal options. Consumers on a hot path should bind the produced schema to a `const` once (the same layer/schema "memoized by reference — bind to constants" discipline the standards state for layers). `JsoncFromString` is the pre-bound singleton precisely so the common default-options case needs no such discipline. This is documented on both factory statics.

## Error set (derived from raise sites)

Enumerated from actual construction sites in the v3 source, not the export list. The restrained aggregate design (review §1 rates it "the best" error shape in the library, and correct where yaml-effect's nine classes are wrong) is preserved:

| Error | Raised by | Payload |
| --- | --- | --- |
| `JsoncParseError` | `Jsonc.parse` / `Jsonc.parseTree`; `JsoncFromString` / `fromString` / `schema` decode | `errors: ReadonlyArray<JsoncParseErrorDetail>`, `input: string` |
| `JsoncModificationError` | `JsoncModifier.modify` (navigation miss / invalid edit) | `path: JsoncPath`, `reason: string` (structured), `offset?: number` |

`JsoncParseErrorDetail` is a `Schema.Class` (not an error) carrying `code: JsoncParseErrorCode`, `offset`, `length`, `line`, `character` — one detail per recovered parse error, so a single `JsoncParseError` reports the whole batch. Both errors are `Schema.TaggedErrorClass`, `message` derived via getter from the structured fields (never preformatted strings).

**Cycle-avoidance ownership decision (carry-forward learning applied).** `JsoncParseError` is owned by the `Jsonc` facade, but the internal parser must not import it, or `Jsonc.ts → internal/parser.ts → Jsonc.ts` becomes an import cycle (`noImportCycles` is error-level — this is the exact hazard that forced `SemVer.diff` to be dropped in the semver port). Resolution, mirroring semver's grammar: **`internal/parser.ts` returns plain parse results plus raw error records (`{ code, offset, length }`); `Jsonc.ts` maps those into `JsoncParseErrorDetail` (computing `line`/`character` from `offset` against the source text) and constructs the aggregate `JsoncParseError` itself.** The parser depends on nothing in `Jsonc.ts`; the facade depends on the parser. `JsoncParseErrorDetail`/`JsoncParseErrorCode` live with the facade because that is where details are materialized. `internal/navigate.ts` is symmetric: it returns plain navigation results and `JsoncModifier.ts` constructs `JsoncModificationError`. To verify at port time: confirm `JsoncNode` (imported by `internal/parser.ts` for tree mode) has no back-edge into `Jsonc.ts` (its `find`/`findAtOffset` methods walk `children` locally and must not import the parser).

As-built: the firewall landed exactly as designed. `src/internal/parser.ts` owns the `JSONC_PARSE_ERROR_CODES` const and returns raw `{ code, offset, length }` records; `Jsonc.ts` builds the `@public JsoncParseErrorCode` schema *from* that const and computes each detail's `line`/`character` from `offset` against the source text. Because offsets are the parser's single positional currency, the scanner dropped its own `line`/`character` tracking accordingly. One wrinkle: `JsoncModificationError.offset` exists in the payload (per the table above) but is currently **unpopulated** — modify mismatches carry `path` + `reason` and leave `offset` absent; populating it is deferred until a consumer needs positional modify errors.

**Single scan-error mapping (review §2).** The v3 scan-error→parse-code translation was duplicated in both `parse.ts#scanNext` and `visitor.ts#scanNext`. It collapses to a single internal helper in `internal/parser.ts`, consumed by both the parser and the visitor. The two overlapping vocabularies (`JsoncScanError` + `JsoncParseErrorCode`) unify: raw scanner codes stay internal to `scanner.ts`; `JsoncParseErrorCode` is the single public code vocabulary.

**Dead error dropped (review §2).** `JsoncNodeNotFoundError` (and its `*Base` pair) is exported and documented in v3 as "`findNode` may fail with this error" and is in the `JsoncError` union, but nothing in `src/` ever raises it — `findNode` returns `Option.none()`, which is the better design. The error is dropped; the `Option` return is kept. This mirrors semver's verified-dead `InvalidBumpError`/`InvalidPrereleaseError` removal.

## Equal and Hash semantics

`Schema.Class` structural equality is load-bearing for the visitor/token tests (`Equal.equals` on nodes) — verify v4 `Schema.Class` equality semantics before porting assertions (review §3). `Jsonc.equals`/`equalsValue` implement the *semantic* (comment/format-ignoring, key-order-independent) equality that is distinct from structural `Equal.equals`, so they stay explicit statics rather than leaning on the derived instance equality.

Carry-forward learning applied: **if any class customizes `[Equal.symbol]`, it MUST override `[Hash.symbol]` too** — `Equal.equals` fast-paths on hash mismatch, so overriding equality alone silently fails (the semver `SemVer` hook). The AST nodes are not expected to need custom equality (structural is correct for them), so this is a guardrail to check during the port, not a planned customization; if `JsoncNode` ends up customizing equality for semantic comparison, the hash override is mandatory and gets a regression test pinning hash agreement.

## jsonc/yaml parity convention

**Decision 3, resolved: NO shared-package extraction now.** The review (§5) flagged that yaml-effect is a structural clone (`YamlEdit`≈`JsoncEdit`, `YamlRange`≈`JsoncRange`, `YamlPath`≈`JsoncPath`, matching `equality`/`format`/`visitor`/`schema-integration` and the same error-detail-with-position shape). Extraction into an `@effected/text-edit` / `@effected/document` micro-kernel is **deferred** — the decision is made only *after both* the jsonc and yaml ports land, matching [package-inventory.md](../package-inventory.md)'s recorded position (the only justified extraction is a possible later `@effected/text-edit` micro-kernel covering Edit/Range/Path/diff).

In its place, a **binding written parity convention** (a migration requirement for `@effected/yaml`):

> `JsoncEdit`, `JsoncRange`, `JsoncPath`, `JsoncSegment`, `JsoncFormattingOptions` and the parse-error-detail-with-position shape (`JsoncParseErrorDetail`'s `code`/`offset`/`length`/`line`/`character` fields) MUST be **structurally identical** to their future `Yaml*` counterparts — same field names, same types, same optionality, same semantics for `applyAll`/`equals`/`equalsValue`/`schema`/`fromString`.

The point is codec-generic consumer code: a consumer should be able to write one function over "a document codec's Edit/Range/Path" and have it work against both `@effected/jsonc` and `@effected/yaml`. Implementing yaml against these shapes *is* the pre-work for a later kernel extraction — the extraction becomes a mechanical lift once two callers prove the shapes identical, rather than a speculative abstraction before the second parser exists.

As-built (recorded once the yaml port landed): `Edit`/`Range`/`Path`/`Segment` and the diagnostic-core parity held exactly as designed. `YamlFormattingOptions` is the one exception — it derives its shared fields from `YamlStringifyOptions` at *runtime* by spreading `.fields`, which is not structurally identical to `JsoncFormattingOptions`'s hand-derived shape even though field names and semantics line up. See [yaml.md's options derivation](yaml.md#options-derivation) for the full reconciliation; the parity convention's binding requirement stands for every other shared-vocabulary type.

## Observability plan

v3 has zero instrumentation. Per the observability standard, `Effect.fn("name")` at public *fallible* operation boundaries only: `Jsonc.parse`, `Jsonc.parseTree`, `JsoncModifier.modify`, and the schema decode entry (`Jsonc.schema` / `fromString` decoding) — ~4 named spans. `JsoncVisitor.visit` gets a named stream constructor span. Pure synchronous operations (`stripComments`, `equals`/`equalsValue`, `JsoncFormatter.format`, `JsoncEdit.applyAll`, `JsoncNode.toValue`) are *not* instrumented — consistent with the wrapping policy: no `Effect`, no span. Internal scanner/parser/navigate helpers get no spans. The library stays telemetry-agnostic — no OTel configuration anywhere; applications compose `@effect/opentelemetry` at the edge.

As-built: `parse`, `parseTree` and `modify` are instrumented as designed, but `JsoncVisitor.visit` is **not** span-wrapped — the named stream constructor span is **deferred**. Stream construction is lazy and pure (`Stream.fromIterable` over the generator), with no clean `Effect.fn` boundary to attach the span to without forcing the stream into an effect it does not otherwise need. Instrumenting the visitor waits for a design that names the span without eagerly evaluating the stream.

## API Extractor bases (house policy)

Ratified 2026-07-07 (semver commit 5f854fb), applied here from the start rather than discovered mid-port. Every Effect class factory (`Schema.Class` for `JsoncNode`, `JsoncEdit`, `JsoncRange`, `JsoncFormattingOptions`, `JsoncParseOptions`, `JsoncParseErrorDetail`; `Schema.TaggedErrorClass` for `JsoncParseError`, `JsoncModificationError`; any `Schema.Union`/`TaggedEnum` base for the visitor events) gets a named, exported `X_base` const with an **explicit factory-return-type annotation**, tagged **`@public`** (not `@internal` — the `@internal`-with-residual-`ae-incompatible-release-tags`-warnings idiom is superseded), re-exported from `index.ts`, each carrying a "not meant to be referenced directly" doc comment. Any schema helper const referenced by those annotations (field schemas, literal sets) is likewise `@public` with the same note — silk's binary release-tag policy propagates: anything a `@public` signature references must itself be `@public`. Target is a zero-warning `dist/prod/issues.json`. The extra public surface is the accepted cost, distinguished from the banned v3 `*Base` ceremony by the not-for-direct-use doc comments. Idiom and worked example: `plugin/skills/effect-api-extractor-bases/SKILL.md`.

## v4 API drift to verify early

The semver port was burned mid-way when v4 removed `SortedSet`. The equivalent exposure here is **`Stream`/`Chunk`** in `JsoncVisitor.visit` (`Stream.fromIterable` wrapping a generator) and `visitCollect`'s removed `Chunk.toReadonlyArray` path. Verify the v4 `Stream`/`Chunk` surface (`fromIterable`, `take`, `filter`, `runCollect`) against the installed `effect` beta **before** committing to the visitor design, not after. Also verify v4 `ParseResult` shape (the one core type that changes materially, review §3) at the schema-transformation boundary.

As-built (verified against the installed beta): `Stream.runCollect` returns `Effect<Array<A>>` in v4 — there is no `Chunk` intermediary, so the `Chunk.toReadonlyArray` step vanishes from the collect path entirely. There is **no `ParseResult` module** in v4: the schema transformations use `SchemaTransformation.transformOrFail` via `Schema.decodeTo`, failing with a `SchemaIssue.InvalidValue` (see [Schema transformation strategy](#schema-transformation-strategy)) rather than a `ParseResult` failure. The visitor event union is a `Data.taggedEnum` (`JsoncVisitorEvent = Data.taggedEnum<JsoncVisitorEvent>()`), the concrete choice among the "Schema.Union or Data.TaggedEnum" options the design left open.

## Deliberately not ported

- **The public scanner** (`createScanner` / `JsoncScanner`). **Decision 2, resolved:** the scanner is the mutable imperative engine and moves to `src/internal/scanner.ts`; there is no public `createScanner`/`JsoncScanner`. A `Stream<JsoncToken>` tokenizer (the Effect-native way to expose token-level access, review §2) is **explicitly deferred until a consumer materializes** — no speculative public tokenizer now. `JsoncToken` / `JsoncSyntaxKind` / `JsoncScanError` move internal with it.
- **The fifteen floating functions** — absorbed as statics/instance methods; `Function.dual` and the overload-object const signatures dissolve.
- **`formatAndApply`** — replaced by `JsoncFormatter.formatToString` (the one surviving convenience) plus the general `format` + `JsoncEdit.applyAll`.
- **`visitCollect`** — `Stream` combinators suffice.
- **`JsoncNodeNotFoundError`** and its `*Base` pair — verified-dead (never raised); `Option` kept (see the error set).
- **All public `*Base` export pairs** (`JsoncParseErrorBase`, `JsoncNodeNotFoundErrorBase`, `JsoncModificationErrorBase`) — v3's doubled public surface stays banned. The API-Extractor base need is met by the documented `@public X_base` house idiom above, which is a *different* thing: documented, minimal, and not presented as real API.
- **The duplicated scan-error→parse-code mapping** — collapsed to one internal helper (see the error set).
- **The fragile `lastIndexOf('"segment"')` navigation** in `modify` — replaced by the tested `internal/navigate.ts`.
- **Any invented `Context.Service`** — pure tier needs none; the review explicitly warns not to invent one (§3).

## Testing strategy

`@effect/vitest` with `it.effect` as the default mode; never plain `it()` + `Effect.runPromise`/`runSync` (v3's single 2,037-line co-located `src/index.test.ts` is all plain vitest and converts wholesale). Tests live in `packages/jsonc/__test__/` split per concept (`Jsonc`, `JsoncNode`, `JsoncEdit`, `JsoncFormatter`, `JsoncModifier`, `JsoncVisitor`), per repo convention; construct instances via `X.make(...)`, never `new X(...)`.

- **Property tests via `it.effect.prop`** with `Schema.toArbitrary` (review §2's suggestions): `applyAll ∘ format` idempotence (formatting a formatted document is a no-op), and `parse ∘ stripComments` agreement with `JSON.parse` (stripping comments then parsing agrees with native JSON on comment-free-equivalent input). Any `isPattern` field checks introduced use lookahead-free regexes so `Schema.toArbitrary` derivation works (the fast-check `stringMatching` constraint the standards call out).
- **Port the offset-discipline regression tests** (issue #62 spans) — the subtle token-end correctness work is the safety net for the redesign; port the invariant *and* its cases.
- **Navigation tests** pinning `internal/navigate.ts` against keys containing quotes and other characters that broke the v3 string search — this is where the correctness fix must be proven.
- **Round-trip / behavior-contract tests**: edits-not-mutations byte-minimality (comments/whitespace preserved), `equals`/`equalsValue` key-order and array-order semantics, `modify` delete-via-`undefined` and append-after-last insertion, `stripComments` offset preservation.
- **Schema-pipeline tests**: `Jsonc.schema(Target)` decode/encode over commented input, and the boundary guarantee that decode failures surface as `JsoncParseError` (never `SchemaError`).

Verify-during-implementation items (v4 `Stream`/`Chunk`/`ParseResult` drift, `Schema.Class` equality semantics, the `JsoncNode`↔`Jsonc.ts` cycle check, and any `Equal`/`Hash` customization) are called out inline in the sections above and resolve to as-built notes when the port lands.

As-built: **62 tests** cover every designed behavior contract — offset discipline (issue #62 spans), edits-not-mutations byte-minimality, `equals`/`equalsValue` equality semantics, the `modify` delete/insert contracts, `stripComments` offset preservation, the `Jsonc.schema` decode/encode pipeline, quote-containing-key navigation through `internal/navigate.ts`, and both property tests (`applyAll ∘ format` idempotence, `parse ∘ stripComments` agreement with `JSON.parse`). Known depth gaps versus the v3 271-test suite, flagged for backfill only if parity *depth* is wanted: per-error-code assertion breadth, `keepLines` formatting permutations, deep/wide document fixtures, and a dedicated multi-line block-comment `stripComments` offset fixture. The as-built suite proves the contracts; the gaps are additional coverage of the same contracts, not undocumented behavior.
