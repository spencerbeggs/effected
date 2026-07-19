---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-07-19
last-synced: 2026-07-19
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - semver.md
  - jsonc.md
  - toml.md
  - markdown.md
  - package-json.md
  - npm.md
---

# @effected/yaml design

## Overview

`@effected/yaml` is YAML 1.2 as pure Effect Schema schemas — the largest package in the repo. It carries the full layered pipeline (lex → CST → compose → value), the "Schema IS the class" AST, an edits-not-mutations model, a warnings-as-data recoverable-parse design, a vendored compliance harness and a string→domain schema DX. Class-based DX throughout: statics and instance methods on the schema classes, no floating functions, no `Fn.dual` ceremony.

[@effected/jsonc](jsonc.md) is the structural template. The [jsonc/yaml parity convention](jsonc.md#jsoncyaml-parity-convention) is **binding**: every shared-vocabulary concept (`Edit`, `Range`, `Path`, `Segment`, and the parse-error-detail-with-position shape) is structurally identical to its `Jsonc*` counterpart, so codec-generic consumer code works against both — see [parity reconciliation](#jsoncyaml-parity-reconciliation).

## Tier and dependencies

Pure tier — no IO anywhere. All inputs are strings; all outputs are values, documents, edits, streams or domain errors; even the visitor streams are pure. `peerDependencies`: `effect` only. No `@effect/platform*` or `node:` imports; `@effected/config-file` depends on this package via a one-file codec adapter, not the reverse. `"sideEffects": false`.

## Module layout

Per the module-per-concept standard, public source files plus an internal engine directory:

- `src/index.ts` — public surface, re-exports only.
- `src/Yaml.ts` — the facade. Statics `parse`, `parseAll` (value-level), `stringify`, `stripComments`, `equals`, `equalsValue`, and the schema factories `schema(Target, options?)` / `fromString(options?)` / `allFromString(options?)` / `bind(Target)` plus the `YamlFromString` default-options schema. Owns `YamlParseOptions`, `YamlStringifyOptions`, `YamlParseError`, `YamlStringifyError` and the `YamlBoundCodec` interface.
- `src/YamlDiagnostic.ts` — the structured diagnostic concept, carrying both errors *and* warnings-as-data on `YamlDocument`. Owns the staged code literal unions (lex/parse/compose stages) and the **single** fatal-code predicate.
- `src/YamlNode.ts` — the mutually-recursive AST, co-located in one file (the co-location breaks the import cycle). `YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`, the `YamlNode` union, and the `ScalarStyle`/`CollectionStyle` literal sets, with instance navigation methods and `X.is` static guards.
- `src/YamlDocument.ts` — `YamlDocument` and `YamlDirective`, carrying `errors`/`warnings` `YamlDiagnostic` arrays for the recoverable-parse design.
- `src/YamlEdit.ts` — `YamlEdit` (`Schema.Class`) plus static `applyAll(text, edits)` → `string`. Owns the shared edit vocabulary: `YamlRange` and the `YamlPath`/`YamlSegment` type aliases.
- `src/YamlFormat.ts` — `format` / `formatToString`, `modify` / `modifyToString`, and `YamlFormattingOptions`. Owns `YamlModificationError`.
- `src/YamlVisitor.ts` — the Schema-backed event union and `visit(text, options?)` → `Stream<YamlVisitorEvent>`, with the `maxAliasCount` DoS guard. AST-level only.
- `src/internal/` — the private engine: `lexer.ts` (the scanner state machine, which is also the pull-based incremental scanner), `cst-parser.ts`, the `composer/` monolith split along its seams (`state.ts`, `block.ts`, `flow.ts`, `scalars.ts`, `tags.ts`, `anchors.ts`, `document.ts`), `stringifier.ts`, `fold.ts`, `diff.ts`, `equal.ts`, `cst-visitor.ts`, plus the raw-diagnostic and options helpers.

The only composer cycle is `block.ts` → `flow.ts`, broken by a `FlowComposers` dispatch record on `ComposerState` that `document.ts` injects; no generic `composeNode` dispatcher is needed. `parseDirective` lives in `tags.ts` because `validateTagHandlesInDocument` needs it there.

### CST and lexer layers are internal

The public surface is the value/document layers plus the AST, the edit/format/modify concepts, the AST-level visitor and the schema factories. The lexer, CST parser, pull-based scanner and CST visitor all live in `src/internal/` — there is **no public `YamlToken` / `YamlCst`**, and `YamlToken`/`YamlTokenKind`/`CstNode`/`CstNodeType` and the CST event union are internal types.

A `Stream<YamlToken>` / `Stream<CstNode>` public interface — the Effect-native way to expose token- and CST-level access for LSP tooling — is **deferred until a consumer materializes**. The layers stay internal modules and are promoted to public surface only when an LSP-tooling consumer exists.

## Effect-wrapping policy

**Pure synchronous methods where nothing can fail; `Effect` only where the error channel is real; `Stream` for the visitor.**

- **Pure synchronous**: node navigation (`YamlNode.find`, `findAtOffset`, `pathOf`), value extraction (`YamlNode.toValue`, `YamlDocument.toValue`), edit application (`YamlEdit.applyAll`, `YamlFormat.formatToString`/`modifyToString`), the formatting-edit *computation* (`YamlFormat.format`), comment stripping (`Yaml.stripComments`), and semantic equality (`Yaml.equals`/`equalsValue`). These are total functions; an `Effect<_, never>` wrapper is ceremony.
- **`Effect`** (real typed `E`): `Yaml.parse` / `parseAll` (fail `YamlParseError`), `Yaml.stringify` / `YamlDocument.stringify` (fail `YamlStringifyError`), `YamlFormat.modify` (fail `YamlModificationError`), and the schema decode path.
- **`Stream`** for the visitor: `YamlVisitor.visit` returns `Stream<YamlVisitorEvent>`; malformed input surfaces as error events in the union, keeping the stream demand-driven and infallible at the type level.
- **`Result`** (sync escape hatch): `Yaml.parseSync` / `Yaml.stringifySync` return a v4 `Result` for config-time callers that cannot enter the Effect runtime; the same typed failures as their Effect counterparts, materialized synchronously rather than thrown.

The pure/Effect split makes fallible operations legible at the call site — an `Effect` return type *means* "this can produce a domain error."

## Public API

### Yaml (facade)

A namespace object of statics over the parser, stringifier and schema layers. Not a schema class.

- `parse(text, options?)` → `Effect<unknown, YamlParseError>`. Single-document value parse; error-recovery collects all fatal diagnostics and fails once with the aggregate.
- `parseAll(text, options?)` → `Effect<ReadonlyArray<unknown>, YamlParseError>`. Multi-document value parse.
- `stringify(value, options?)` → `Effect<string, YamlStringifyError>`.
- `parseSync(text, options?)` → `Result<unknown, YamlParseError>` and `stringifySync(value, options?)` → `Result<string, YamlStringifyError>` — the v4-`Result` escape hatches for config-time callers that cannot `await` (a `vitest.config.ts`, say). Pure: they drive the same synchronous engine the Effect variants do and share the `stringifyDefectToError` / `aliasCountExceededError` materialization helpers, so hardening is identical across both — the fail-typed-never-a-defect contract holds. Malformed or adversarial input (fatal diagnostics, duplicate keys, an alias-expansion bomb, a circular reference, depth overflow) returns a `Failure` Result, never throws.
- `stripComments(text, replaceCh?)` → `string`. Scanner-based, total in both modes: without a `replaceCh`, comment characters are deleted with line breaks kept; with one, offsets are preserved by replacing in place. Pure and quote-aware in both branches.
- `equals(a, b)` / `equalsValue(a, b)` → `boolean`. Semantic equality (comments/formatting ignored). Any recorded parse error, or a `DuplicateKey` warning, on either side yields `false` — malformed input is never equal to anything, including itself.
- `schema(Target, options?)`, `fromString(options?)`, `allFromString(options?)`, and the `YamlFromString` default-options schema — see [schema transformation strategy](#schema-transformation-strategy). `fromString` takes **parse** options only; the encode direction uses default stringify options.
- `bind(Target)` → `YamlBoundCodec<T, RD, RE>` (2026-07-19) — `{ schema, decode, encode }`: the composed `schema` plus both directions derived from it once via `Schema.decodeEffect`/`Schema.encodeEffect`. Thin sugar over `schema(Target)`, introducing **no new error taxonomy** — both directions fail `Schema.SchemaError` exactly as the hand-written pair would, with the target's `RD`/`RE` flowing through. **Single-document form only**: multi-document stays on `allFromString`, since a bound codec's `decode: (text) => T` shape has no natural array reading, and inventing a `bindAll` for a surface with no jsonc/toml analog would spend parity for no consumer. Schema-producing — bind the result to a `const`.
- Owns `YamlParseOptions` and `YamlStringifyOptions` (both `Schema.Class` with bare `optionalKey` fields and implementation-level defaults — see [options](#options-derivation)).

### YamlNode (AST)

The mutually-recursive AST, co-located in one file. Each node is a `Schema.TaggedClass`, recursion handled with `Schema.suspend` and no parent pointers (parent pointers would break structural equality, serialization and Schema encode/decode).

- `YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`; the `YamlNode` union; `ScalarStyle`/`CollectionStyle` literal sets.
- Instance navigation: `find(path)` → `Option<YamlNode>`, `findAtOffset(offset)` → `Option<YamlNode>`, `pathOf(node)` → `Option<YamlPath>` (reference-identity based — the inverse of `find`, composable with `findAtOffset`), `toValue(anchors?)` → `unknown` (sync, alias-resolving, with the anchor map threaded as the optional argument). Absence stays `Option`, never a `NotFound` error.
- Construct via `YamlScalar.make(...)` in public surface, tests and doc examples — never `new` (see [internal construction](#internal-construction)).

Value-extraction discipline: `Yaml.parse` resolves aliases against the most recently seen anchor at the point of use (single-document parse semantics); `Yaml.parseAll` builds an independent anchor map per document. `__proto__` mapping keys become own data properties via `Object.defineProperty` in `toValue`, closing the prototype-pollution footgun a naive `obj["__proto__"] = value` assignment would open.

### YamlDocument

`YamlDocument` (`Schema.Class`) and `YamlDirective`, carrying `errors`/`warnings` arrays of `YamlDiagnostic` for the recoverable-parse design (non-fatal issues as data alongside typed failure for fatal ones).

- Statics: `parse(text, options?)`, `parseAll(text, options?)`, `schema(options?)`.
- Instance: `stringify(options?)` → `Effect<string, YamlStringifyError>`, `toValue()` → `unknown`.

The framing flags (`hasDocumentStart`/`hasDocumentEnd`/`hasDocumentStartTab`) are bare `optionalKey` booleans with an implementation-level `?? false`. `YamlDocument.schema` targets `Schema.instanceOf(YamlDocument)` as its `decodeTo` destination — `Schema.decodeTo(Class)` expects the transformation to produce the class's *encoded* struct, not instances, so `instanceOf` is the correct decode target for a schema that yields `YamlDocument` instances.

### YamlEdit

`Schema.Class` holding `offset`, `length`, `content`. Static `applyAll(text, edits)` → `string` applies edits in reverse-offset order (byte-minimal, comment/whitespace-preserving — the library's real differentiator) and **rejects overlapping edits as a defect** (2026-07-19): overlapping splices are a caller wiring error, not recoverable input. That guard adopts [toml](toml.md)'s posture, harmonizing `applyAll` across all four format siblings — the divergence [markdown](markdown.md)'s P4 parity note recorded is closed. Named `applyAll` to match `JsoncEdit.applyAll` (parity). Owns `YamlRange` (`Schema.Class`: `offset`, `length`) and the `YamlPath` / `YamlSegment` type aliases, all bound by the parity convention.

### YamlFormat

- `format(text, range?, options?)` → `ReadonlyArray<YamlEdit>` (pure — computes edits, never fails).
- `formatToString(text, range?, options?)` → `string` (`applyAll ∘ format`).
- `modify(text, path, value, options?)` → `Effect<ReadonlyArray<YamlEdit>, YamlModificationError>`. `value === undefined` means delete; insertion appends after the last pair/element.
- `modifyToString(text, path, value, options?)` → `Effect<string, YamlModificationError>` (`applyAll ∘ modify`).
- `YamlFormattingOptions` — see [options derivation](#options-derivation).

`format`/`modify` accept a positional `range` typed as `YamlRangeLike` (`YamlRange | { offset; length }`), so no separate raw-options shape is needed. Errors carry structured `diagnostics: ReadonlyArray<YamlDiagnostic>` payloads, never preformatted reason strings.

### YamlVisitor

- `visit(text, options?)` → `Stream<YamlVisitorEvent>`, wrapping the generator with `Stream.fromIterable` (demand-driven, `Stream.take`-friendly). The event union is a `Data.taggedEnum` (serializable, consistent with the library). Begin/pair/scalar events carry `path` context; an `Error` variant carries a materialized `YamlDiagnostic`. `visit` is **infallible by design**: every composer diagnostic — errors, warnings and stream-level directive errors — surfaces as an `Error` event rather than failing the whole stream. The `maxAliasCount` DoS guard surfaces through `Error` events for free.

## Schema transformation strategy

Mirrors jsonc's flagship arrangement:

- `Yaml.YamlFromString` — a `Schema<unknown, string>` transformation using the parser with the *default* `YamlParseOptions`. The zero-config, pre-bound entry point.
- `Yaml.fromString(options?)` — a factory returning a `Schema<unknown, string>` bound to the supplied options; `YamlFromString` is `Yaml.fromString()` with defaults.
- `Yaml.allFromString(options?)` — the multi-document factory, returning `Schema<ReadonlyArray<unknown>, string>`. No jsonc analog.
- `Yaml.schema(Target, options?)` — composes `fromString(options)` with a target `Schema`, yielding the `Schema<A, string, R>` pipeline that is the single best consumer-facing feature. The `R`-polymorphic signature is preserved.

**Boundary discipline.** A `Schema` cannot fail with a domain error. The `Schema.decodeTo` transformation fails with a `SchemaError` carrying a `SchemaIssue.InvalidValue` whose message is the aggregate parse message (with line/column enrichment); the *domain* `YamlParseError` is constructed directly by the `Yaml.parse` / `parseAll` path (which drives the internal composer and bypasses `Schema`). Consumers wanting the domain error from a schema pipeline normalize with `Effect.catchTag("SchemaError", …)`. `SchemaError` never escapes as the documented contract of `parse`/`parseAll`.

**Memoization-by-reference caveat.** `fromString(options)`, `allFromString(options)` and `schema(Target, options)` are schema-*producing* functions — each call returns a fresh schema instance, and v4 schema derivation caches key by reference. Hot-path consumers should bind the produced schema to a `const` once. `YamlFromString` is the pre-bound singleton for the common default case.

## Error set

Three `Schema.TaggedErrorClass` types, each with structured payloads and a `message` getter derived from the fields — never preformatted strings, never collapsed to a `reason: string`. `YamlDiagnostic` is a `Schema.Class`, so error payloads are serializable for free.

| Error | Raised by | Payload |
| --- | --- | --- |
| `YamlParseError` | `Yaml.parse` / `parseAll` / `YamlDocument.parse` / `parseAll`; `YamlFromString` / `fromString` / `allFromString` / `schema` decode | `diagnostics: ReadonlyArray<YamlDiagnostic>`, `input: string` |
| `YamlStringifyError` | `Yaml.stringify` / `YamlDocument.stringify` | `diagnostics: ReadonlyArray<YamlDiagnostic>`, plus the offending value context |
| `YamlModificationError` | `YamlFormat.modify` (navigation miss / invalid edit) | `path: YamlPath`, `diagnostics: ReadonlyArray<YamlDiagnostic>` |

There is no `YamlFormatError`: `format` is pure and returns `[]` (no edits) on input whose parse has fatal errors, so it never corrupts a malformed document and never needs a fallible path. The stringify and modify code unions carry their own staged codes: `YamlStringifyErrorCode = ["CircularReference", "NestingDepthExceeded"]` and `YamlModifyErrorCode = ["EmptyDocument", "PathNotFound", "InvalidIndex", "NotNavigable"]`.

### YamlDiagnostic — single source of truth

`YamlDiagnostic` is used for both errors *and* warnings-as-data on `YamlDocument`. It owns the staged code literal unions (the lex/parse/compose-stage code sets) and — critically — a **single fatal-code predicate**, so fatality is declared once as a property of the code rather than inlined in each parse entry point.

Hardening additions carried by the fatal predicate, all typed (never a defect), all covered by tests with compliance unaffected:

- Raw C0 control characters (other than tab/LF/CR) anywhere in a document's span are fatal `UnexpectedCharacter`, scanned once per document per YAML 1.2 §5.1 c-printable.
- Nesting depth is capped at `MAX_NESTING_DEPTH = 256` in the composer (fatal `NestingDepthExceeded`) and 264 in the CST parser (set above the composer's cap so the user-facing diagnostic always fires first). The uncapped engine overflowed the stack at roughly 900 nesting levels.
- An alias-expansion "billion laughs" bomb that stays under `maxAliasCount` but exhausts the heap during value materialization is caught by an **alias-expansion budget derived from `maxAliasCount`**; the internal throw is materialized into a fatal `YamlParseError` carrying an `AliasCountExceeded` diagnostic.
- Deep-input stringify stack overflows on both the plain-value path (`internal/stringifier.ts`) and the AST-node path are capped at the shared `MAX_NESTING_DEPTH`; the internal throw is materialized into a fatal `YamlStringifyError` carrying a `NestingDepthExceeded` diagnostic.

**Cycle-avoidance ownership.** `YamlParseError` is owned by the `Yaml` facade, and the internal composer must not import it (`Yaml.ts → internal/composer/… → Yaml.ts` would be an import cycle, `noImportCycles` is error-level). Resolution: the internal engine returns plain results plus raw diagnostic records (`{ code, offset, length, message }`); the facade materializes `YamlDiagnostic` (adding `line`/`character` computed from `offset` against the source text) and constructs the aggregate error itself. `YamlDiagnostic` and its code unions live in `YamlDiagnostic.ts` because that is where diagnostics are materialized.

## jsonc/yaml parity reconciliation

The [parity convention](jsonc.md#jsoncyaml-parity-convention) requires `YamlEdit`, `YamlRange`, `YamlPath`, `YamlSegment` and the diagnostic core to be structurally identical to their `Jsonc*` counterparts. `YamlDiagnostic` adopts the `line`/`character` naming (the shared five-field core: `code`/`offset`/`length`/`line`/`character`), with any extra fields (`message`, `severity`) additive on top. The point is codec-generic consumer code — one function over "a document codec's Edit/Range/Path" that works against both `@effected/jsonc` and `@effected/yaml`. This is the pre-work for a later `@effected/text-edit` micro-kernel extraction, deferred until a consumer needs it.

`Edit`/`Range`/`Path`/`Segment` and the diagnostic core hold exact parity. `YamlFormattingOptions` is the one exception — see below.

### Options derivation

All three options classes (`YamlParseOptions`, `YamlStringifyOptions`, `YamlFormattingOptions`) use **bare `optionalKey` fields with implementation-level `?? default`** rather than v4 constructor/decoding-default wrappers, which keeps the class-factory annotations tractable. `YamlFormattingOptions` derives its shared fields **at runtime by spreading `YamlStringifyOptions.fields`** (v4 classes expose `.fields`), adding `preserveComments` and `range` on top. Because the field-spread mechanics differ from jsonc's hand-derived shape, `YamlFormattingOptions` is **deliberately not structurally identical to `JsoncFormattingOptions`** even though the field names and semantics line up — this is the parity exception; `Edit`/`Range`/`Path`/`Segment`/diagnostic-core parity all still hold. The `stringify` signature is a single `YamlStringifyOptions?` parameter.

The runtime field-spread earns its keep here: `indentSequences` (below) was added to `YamlStringifyOptions` alone and appeared on `YamlFormattingOptions` **derived, not hand-duplicated** — which is exactly the drift the spread exists to prevent.

### `indentSequences` — presentation, not fidelity

`YamlStringifyOptions` and `YamlFormattingOptions` carry an optional `indentSequences` controlling how a block sequence nested under a mapping key is presented: `false` emits it at the key's column, `true` indents it one level (the `yaml` npm package's and prettier's default shape). Top-level sequences sit at column zero in both modes.

**The default is `false`, and the default is the whole decision.** Both forms are valid YAML parsing to identical data, so this is presentation, not semantics — but the kit's stringifier is byte-compatible with yaml-effect 0.7, and flipping a default that changes *bytes* would rewrite sequence indentation in every file every existing consumer round-trips. A cosmetic default is not worth a diff in every downstream repo; consumers who want the popular shape ask for it.

The **explicit-key compact-sequence branch is deliberately untouched** by the option. `? key` / `: value` explicit-key syntax is a different construct with its own emitter path, and folding it under the same flag would mean changing a form nobody asked about while chasing the common one.

### `lineWidth` — real column folding

`lineWidth` now performs the column-based scalar folding it always advertised. It was previously **inert**: threaded into the stringifier's render context (`internal/stringifier.ts`) but never read, so output never wrapped for any value. A positive `lineWidth` now folds long **plain**, **double-quoted** and **block-folded (`>`)** scalars at approximately that column, inserting only semantically transparent line breaks — breaks a reader folds back to a single space, so the round-trip is preserved. **Block-literal (`|`) and single-quoted scalars are never folded**: literal blocks preserve their bytes by definition, and single-quoted folding is out of scope. The two folding functions — `foldScalarLine` (one logical line) and `foldRenderedScalar` (style-aware, dispatching on the rendered scalar's leading character) — live in `internal/fold.ts` and are wired into the **value path** (`stringifyLines` / `stringifyObjectLines` / `stringifyArrayLines`). Flow-collection items pass `allowFold=false`, because they are re-joined with spaces and a fold break would corrupt them.

**The default is `0`, and — as with `indentSequences` — the default is the whole decision.** `0` (and any value `<= 0`) means never wrap. The change lowered the default from `80` to `0`, which is byte-compat-preserving precisely *because* the option was inert: the historic behavior was no-wrap, so defaulting to `0` keeps default output and any explicit `lineWidth: 0` byte-identical, while a positive value opts into folding. The compliance harness stays at 100% for exactly this reason — nothing folds unless a caller asks.

**Value-path-only scope is the documented contract, not a gap** ([issue #105](https://github.com/spencerbeggs/effected/issues/105), resolved 2026-07-17 by documentation — deliberately not by implementing node-path folding). `Yaml.stringify` / `Yaml.stringifySync` are the only entry points that fold; the document/node path (`YamlDocument.stringify` and the `YamlFormat` helpers built on it) threads `lineWidth` into its render context but never reads it, and the schema factories (`fromString` / `schema` / `YamlFromString`) encode with default stringify options, so their output never folds either. The TSDoc on `YamlStringifyOptions.lineWidth` and `YamlDocument.stringify` states the boundary and steers node-path callers that need folding to `Yaml.stringify(doc.toValue(), options)`, and a regression test pins the node path's inertness — so folding cannot land there without forcing the docs to update.

## Multi-document support

Yaml-specific surface with no jsonc analog. YAML's `---`/`...` document-stream model gets first-class support: `Yaml.parseAll` / `Yaml.allFromString`, and `YamlDocument.parseAll` alongside the single-document `YamlDocument.parse` / `schema`. This is genuinely yaml's own concern (anchors, aliases, pairs-vs-properties, multi-document); no shared tree/document abstraction is extracted across jsonc and yaml — the trees differ enough that a shared abstraction would be premature and leaky.

## Equal and Hash semantics

`Schema.TaggedClass` structural equality is load-bearing for the visitor/AST tests (`Equal.equals` on nodes) and works as designed; no node customizes `[Equal.symbol]`, so the `[Hash.symbol]` override obligation never comes into play. `Yaml.equals`/`equalsValue` implement *semantic* equality (comment/format-ignoring, alias-resolving) distinct from structural `Equal.equals`, so they stay explicit statics over `internal/equal.ts`. Should any node ever customize `[Equal.symbol]`, it MUST override `[Hash.symbol]` too — `Equal.equals` fast-paths on hash mismatch — with a regression test pinning hash agreement.

## Observability

Named `Effect.fn` spans at public *fallible* boundaries only: `Yaml.parse`/`parseAll`/`stringify`, `YamlDocument.parse`/`parseAll`/`stringify`, and `YamlFormat.modify`/`modifyToString`. Pure synchronous operations (`stripComments`, `equals`/`equalsValue`, the `YamlNode` navigation methods, `YamlEdit.applyAll`, the `format` edit computation) are not instrumented. There is **no per-node instrumentation inside the composer** (a hot recursive path), and internal lexer/composer/stringifier helpers get no spans. `YamlVisitor.visit` carries no span — stream construction is lazy and pure, with no clean `Effect.fn` boundary. The library is telemetry-agnostic.

## No services

A pure-tier library needs none — class statics suffice, and a config-file-style codec adapter is the consumer's layer. `src/` defines no `Context` and no `Layer`.

## Consumer seam

`@effected/config-file`'s `ConfigCodec` interface is exactly the `Yaml` facade shape, so a one-file `YamlCodec` adapter is trivial (pure→pure, `workspace:*`). The codec lives in `@effected/config-file`, not in `@effected/yaml` — the dependency arrow points *at* yaml, never from it.

## Internal construction

The house rule is `X.make(...)`, never `new X(...)`. The internal engine (`src/internal/`) is the recorded exception: it retains `new` for AST construction on the hot recursive composition path, where the nodes are trusted (built by the parser from validated CST) and per-node `make` validation is exactly the hot-path cost the observability plan already refuses to pay. All public surface, tests and doc examples use `X.make`.

`new X()` on a v4 tagged/schema class **validates structurally** — explicit `undefined` passed for an `optionalKey` field throws even with `{ disableChecks: true }` (that flag only skips refinement checks). The engine's hot-path `new` sites use conditional spreads for every optional field to avoid the throw. Measured construction overhead of the structural validation is small enough to stay within the `new`-retention decision.

## Fixture corpus and compliance harness

The vendored yaml-test-suite is committed as plain files (nested `.git` stripped) under `packages/yaml/__test__/fixtures/yaml-test-suite/`, pinned to a specific upstream ref recorded alongside the fixtures — deterministic, offline and Turbo-cacheable, no fetch-on-test dependency. The compliance harness is the regression safety net, an e2e suite at `packages/yaml/__test__/e2e/*.e2e.test.ts` covering four assertion families: parse success/failure, JSON-equivalence, canonical-output byte-equality and roundtrip. It runs at 100% with empty skip maps.

## Testing

`@effect/vitest` with `it.effect` as the default mode; `assert.*`, never `expect`. Tests live in `packages/yaml/__test__/` split per concept, with the compliance harness under `__test__/e2e/`. Construct instances via `X.make(...)`, never `new X(...)` (the engine's internal `new` sites are the recorded exception).

- **Property tests** via `it.effect.prop` with `Schema.toArbitrary` on the AST classes: parse/stringify roundtrip properties and `applyAll ∘ format` idempotence. Pattern-field checks use lookahead-free regexes so `Schema.toArbitrary` derivation works.
- **The compliance e2e suite** — the safety net.
- **Diagnostic/position tests** pinning `YamlDiagnostic`'s `line`/`character` computation and the single fatal-code predicate.
- **Structure-preserving-error tests**: `format`/`modify`/`stringify` failures carry `YamlDiagnostic` arrays, never `reason` strings.
- **Behavior-contract tests**: edits-not-mutations byte-minimality, `equals`/`equalsValue` semantic equality, `modify` delete-via-`undefined` and append-after-last insertion, `stripComments` offset preservation, multi-document `parseAll` ordering, alias-resolving `YamlNode.toValue(anchors?)`, and `maxAliasCount` DoS protection.
- **Schema-pipeline tests**: `Yaml.schema(Target)` decode/encode, `allFromString` multi-document decode, and the boundary guarantee that decode failures surface as `YamlParseError` (never `SchemaError`) through the `parse`/`parseAll` contract.

Known limitation, the same one the source dialect shipped with: per-node comments (`pair.comment` etc.) are captured by the composer but never re-emitted by the stringifier — only a document-level leading comment round-trips. Closing it is future work if a consumer needs full comment round-tripping.

## Build

All class factories are written inline with no exported `*_base` const; the synthesized `_base` heritage symbols (including the co-recursive `YamlNode.ts` bases and the visitor-event union) are suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern) and land in the `issues.json` `suppressed` bucket, keeping it zero-warning. The `Schema.suspend` callbacks' own return-type annotations (`Schema.Schema<Self>`) survive where recursion requires them. Genuinely-reusable public schemas (the staged code unions, real-API literal sets) stay `@public` on their own merit. The api-extractor model is wired at `website/lib/models/yaml`. This tracks the ratified policy in [effect-standards.md](../effect-standards.md#api-extractor--effect-class-factories).
