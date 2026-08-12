---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../formatter-convention.md
  - ../package-inventory.md
  - ../yaml-lint.md
  - jsonc.md
  - toml.md
  - markdown.md
  - config-file.md
---

# @effected/yaml design

## Overview

`@effected/yaml` is YAML 1.2 as pure Effect schemas, and the largest package in the repo. It carries a full layered pipeline (lex → CST → compose → value), a "the class is the schema" AST, an edits-not-mutations model, a warnings-as-data recoverable-parse design, a vendored compliance harness, string→domain schema factories, full per-node comment fidelity and a yamllint-class lint system over a public token stream. Class-based DX throughout: statics and instance methods on the schema classes, no floating functions.

[@effected/jsonc](jsonc.md) is the structural template, and the [jsonc/yaml parity convention](jsonc.md#jsoncyaml-parity-convention) is **binding** — see [parity reconciliation](#jsoncyaml-parity-reconciliation) for what holds and the one recorded exception.

This doc stays single despite its length: everything below is one library's parsing pipeline and the surfaces that hang off it, not a set of separable subsystems.

## Tier and dependencies

Pure tier — no IO anywhere. Inputs are strings; outputs are values, documents, edits, streams or domain errors, and even the visitor streams are pure. `effect` is the only peer; no `@effect/platform*` or `node:` imports. [`config-file`](config-file.md) depends on this package through a one-file codec adapter, never the reverse. `"sideEffects": false`.

## Module layout

Module-per-concept, with the engine behind `internal/`. `src/index.ts` re-exports; nothing else is public.

- `Yaml.ts` — the value-level facade: a namespace object of statics over the parser, stringifier and schema layers, not a schema class. Owns the parse and stringify option and error vocabulary.
- `YamlDiagnostic.ts` — the structured diagnostic concept carrying errors *and* warnings-as-data, the staged code unions and the **single** fatal-code predicate.
- `YamlNode.ts` — the mutually-recursive AST, co-located in one file. The co-location is what breaks the AST import cycle.
- `YamlDocument.ts` — `YamlDocument` and `YamlDirective`: the parsed AST plus recovered `errors`/`warnings` arrays.
- `YamlEdit.ts` — the edit class and the shared `YamlRange` / `YamlPath` / `YamlSegment` vocabulary bound by the parity convention.
- `YamlFormat.ts` — non-mutating `format` and `modify` edits, and `YamlFormattingOptions`.
- `YamlVisitor.ts` — SAX-style AST events as a `Stream`, including comment events discriminated by `placement`.
- `YamlToken.ts` — the public positioned token stream: `YamlTokenKind`, `YamlToken`, and the `YamlTokens.tokenize` / `.stream` pair.
- `YamlLintRule.ts` — the lint **model**: `LintContext`, `LintLine`, `YamlRule`, `YamlLintSeverity`, `YamlLintDiagnostic`.
- `YamlLint.ts` — the lint **config and facade**: `YamlLintRuleSetting`, `YamlLintConfig` and `YamlLint.run` / `.fix` / `.builtins`.
- `internal/` — the engine: lexer, CST parser and visitor, the `composer/` directory split along its seams (including `composer/comments.ts`), stringifier, folder, differ, equality, the raw-document materializer and `rules/` — one file per built-in lint rule.

The engine is **vendored** — ported with attribution from the `yaml` package rather than taken as a runtime dependency. House policy for pure-tier format packages: a pure package owns its parser. Do not add `yaml` as a dependency.

### Cycle firewall

`noImportCycles` is error-level, and two rules keep it green.

The engine returns **raw records** (`{ code, message, offset, length }`) and never imports a public module; the facade materializes `YamlDiagnostic` — computing `line`/`character` from `offset` against the source — and constructs the typed errors. `YamlDiagnostic` and its code unions live in their own module because that is where diagnostics are materialized.

Mutual recursion threads through a **dispatch record on state**, never a direct import. The block composer needs the flow composer, so `composer/state.ts` declares a `FlowComposers` record and `composer/document.ts` injects the implementations. No generic node dispatcher is needed.

The lint layer obeys the same firewall, and it is what split the lint model out of the facade: built-in rules construct `YamlLintDiagnostic` while the facade imports the rule catalog, so one module would close `YamlLint → rules → YamlLint`. The model lives in `YamlLintRule.ts`, which imports nothing back.

### The token layer is public; CST stays internal

The public surface is the value and document layers, the AST, the edit/format/modify concepts, the AST-level visitor, the schema factories, **the lexical token stream** and the lint system. The CST parser, pull-based scanner and CST visitor remain internal — there is still no public CST type.

The token layer was held private "until an LSP-tooling consumer materializes"; **the lint system was that consumer**, so `YamlToken.ts` promotes the internal lexer token behind a `Result` primitive and a derived `Stream` (design: [yaml-lint.md](../yaml-lint.md#the-public-positioned-token-stream)). The promotion is deliberately **additive**: public `line`/`character` are derived from `offset` against a line index and `text` is the raw source slice, because the internal `column` carries a construct's indent on synthetic markers and the internal `value` is the processed form of a quoted scalar. Deriving left the lexer and CST parser untouched, so nothing behind the new surface could regress. A `Stream<CstNode>` is still deferred on the same terms — the CST layer gets promoted only when something needs it.

## Effect-wrapping policy

**Pure synchronous where nothing can fail; `Effect` only where the error channel is real; `Stream` for the visitor.** The split makes fallibility legible at the call site — an `Effect` return type *means* "this can produce a domain error."

Pure and total: node navigation, value extraction, edit application, the formatting-edit computation, comment stripping and semantic equality. An `Effect<_, never>` wrapper over any of these is ceremony.

Fallible, and therefore `Effect`: parsing, stringifying, modification and the schema decode path. Every one of these also has a synchronous **`Result`** twin for config-time callers that cannot enter a runtime — a `vitest.config.ts`, say. `parseResult` is the package's *single* parse path, with `Yaml.parse` defined in terms of it behind the named span, so the two cannot diverge. The `Result` forms drive the same synchronous engine and share the same defect-materialization helpers, so hardening is identical across both: a fatal diagnostic, duplicate key, alias bomb, circular reference or depth overflow returns a failed `Result` and never throws. Kit convention — [the sync primitive policy](../sync-primitive-policy.md).

The visitor is **infallible by design**: every composer diagnostic, including stream-level directive errors and the alias-count guard, surfaces as an error event in the union rather than failing the stream.

## AST and value extraction

Each node is a `Schema.TaggedClass`, recursion handled with `Schema.suspend` and **no parent pointers** — those would break structural equality, serialization and Schema encode/decode. Absence stays `Option`, never a `NotFound` error. `pathOf` is reference-identity based, the inverse of `find` and composable with `findAtOffset`.

Two value-extraction rules are load-bearing. Single-document parse resolves aliases against the most recently seen anchor at the point of use, while multi-document parse builds an **independent anchor map per document**. And `__proto__` mapping keys become own data properties via `Object.defineProperty`, closing the prototype-pollution footgun a naive `obj["__proto__"] = value` assignment would open.

`YamlDocument.schema` targets `Schema.instanceOf(YamlDocument)` as its `decodeTo` destination, because `Schema.decodeTo(Class)` expects the transformation to produce the class's *encoded* struct rather than instances.

`YamlEdit.applyAll` applies in reverse-offset order — byte-minimal, comment- and whitespace-preserving, the library's real differentiator — and **rejects overlapping edits as a defect**. It is a programmer-error guard on hand-constructed arrays; `YamlFormat` never emits overlapping edits. All four format siblings share this posture.

## Schema transformation strategy

Mirrors jsonc's arrangement: a pre-bound `YamlFromString` singleton on default options, a `fromString(options?)` factory, `allFromString(options?)` for the multi-document case (no jsonc analog), `schema(Target, options?)` composing with a target schema and `bind(Target)` returning `{ schema, decode, encode }`.

`bind` is **single-document only**. A bound codec's `decode: (text) => T` shape has no natural array reading, and inventing a `bindAll` for a surface with no jsonc or toml analog would spend parity for no consumer. Like its neighbors it is thin sugar introducing no new error taxonomy, and like all the schema-producing functions its result should be bound to a `const` on a hot path — each call returns a fresh instance and v4 derivation caches key by reference.

`fromString` takes **parse** options only; the encode direction uses default stringify options.

**Boundary discipline.** A `Schema` cannot fail with a domain error, so the `decodeTo` transformation fails with a `SchemaError` whose issue message is the aggregate parse message. The *domain* `YamlParseError` is constructed directly by the `parse`/`parseAll` path, which drives the composer and bypasses `Schema` — that is why `SchemaError` never escapes as the documented contract of those methods. Consumers wanting the domain error out of a schema pipeline normalize with `Effect.catchTag("SchemaError", ...)`.

## Diagnostics and the error set

Errors are `Schema.TaggedError` with structured payloads and a `message` getter derived from the fields — never preformatted strings, never collapsed to a `reason: string`. `YamlDiagnostic` is itself a `Schema.Class`, so error payloads are serializable for free. See `src/Yaml.ts` and `src/YamlFormat.ts` for the current set.

`YamlDiagnostic` is the single source of truth for **fatality**: it owns the staged code unions and one fatal-code predicate, so fatality is a property of the code declared once rather than inlined at each parse entry point.

The lint layer's `YamlLintDiagnostic` is deliberately a **separate** class rather than a reuse: it carries a rule id, a severity and an optional fix, none of which belong on an engine error-code type. The `parse-validity` rule bridges the two, mapping engine diagnostics into lint ones and keeping the engine's own grading.

There is deliberately **no format error**: `format` is pure and returns no edits on input whose parse has fatal errors, so it never corrupts a malformed document and never needs a fallible path.

## Input hardening

Malformed and adversarial input must fail typed, **never as a defect**. Four surfaces are guarded, all regression-tested:

1. **Composer depth cap**, a fatal nesting diagnostic. The uncapped engine overflowed the stack around 900 levels.
2. **CST parser depth cap**, deliberately set a few levels *above* the composer's cap so the composer's guard fires first and the user gets a positioned diagnostic rather than the CST parser's flat error node. Never lower it to or below the composer cap.
3. **Stringify recursion** on both the value path and the node path, capped at the shared depth constant; the internal throw is materialized into a typed stringify error at the facade.
4. **Alias-expansion budget.** A "billion laughs" bomb can stay under `maxAliasCount` and still exhaust the heap during materialization, so materialized nodes are bounded by a budget derived from `maxAliasCount`, with the internal throw materialized into a typed parse error.

Raw C0 control characters other than tab, LF and CR are fatal anywhere in a document's span, scanned once per document per YAML 1.2 §5.1 c-printable.

The lesson from (4) generalizes: depth is not the only DoS vector. When an engine expands references during materialization, budget the **materialization**, not just the input's static depth.

## jsonc/yaml parity reconciliation

The [parity convention](jsonc.md#jsoncyaml-parity-convention) requires `YamlEdit`, `YamlRange`, `YamlPath`, `YamlSegment` and the diagnostic core to be structurally identical to their `Jsonc*` counterparts. `YamlDiagnostic` adopts the shared five-field core (code, offset, length, line, character), with `message` and `severity` additive on top. All of that holds exactly. The point is codec-generic consumer code — one function over "a document codec's Edit/Range/Path" that works against both packages — and it is the pre-work for a possible `@effected/text-edit` extraction, deferred until a consumer needs it.

`YamlFormattingOptions` is the **one exception**; see below.

### Options derivation

All three options classes use **bare `optionalKey` fields with implementation-level `?? default`** rather than v4 constructor or decoding-default wrappers, which keeps the class-factory annotations tractable.

`YamlFormattingOptions` derives its shared fields **at runtime by spreading `YamlStringifyOptions.fields`** (v4 classes expose `.fields`), adding its own on top. Because those mechanics differ from jsonc's hand-derived shape, it is deliberately **not** structurally identical to `JsoncFormattingOptions` even though field names and semantics line up. That is the recorded parity exception.

The spread earns its keep: `indentSequences` was added to the stringify options alone and appeared on the formatting options **derived, not hand-duplicated** — exactly the drift it exists to prevent.

### `indentSequences` — presentation, not fidelity

Controls how a block sequence nested under a mapping key is presented: at the key's column, or indented one level (the shape the `yaml` npm package and prettier default to). Top-level sequences sit at column zero either way.

**The default is `false`, and the default is the whole decision.** Both forms are valid YAML parsing to identical data, so this is presentation, not semantics — but the kit's stringifier is byte-compatible with its source dialect, and flipping a default that changes *bytes* would rewrite sequence indentation in every file every existing consumer round-trips. A cosmetic default is not worth a diff in every downstream repo; consumers who want the popular shape ask for it.

The **explicit-key compact-sequence branch is deliberately untouched** by the option. `? key` / `: value` syntax is a different construct with its own emitter path, and folding it under the same flag would change a form nobody asked about while chasing the common one. That branch is a *destination* of the spill below, not a thing the option steers — do not conflate the two.

### Explicit-key spill — the implicit-key limit

YAML 1.2 §8.1.3 caps an implicit block-mapping key: the `:` indicator must appear at most 1024 characters after the key's start. Both stringify paths — value and node — therefore **spill** a block-mapping key whose **rendered** form exceeds that limit into explicit-key form, `? key` on its own line and `: value` on the next ([issue #323](https://github.com/spencerbeggs/effected/issues/323)).

Three parts of that are precise on purpose. The measure is the **rendered** key, not the source scalar — quotes and escapes are what a parser counts. The threshold is **strictly greater than** 1024, matching the reference `yaml` package (a rendered key of exactly 1024 stays implicit), because an off-by-one here is the difference between agreeing with every other implementation and producing output they read differently. And the spill is **block-context only**: flow contexts never spill, since flow mappings have no implicit-key line to overrun. Without the spill the emitter produced output that strict parsers reject — a correctness bug against the reference, not a style difference. The real-world input class is the pnpm 11 lockfile `snapshots:` shape, whose parse side was fixed in PR #322.

**`EXPLICIT_COMPACT_PAD` is a recorded divergence from the reference.** Compact continuation lines — the lines after `: first-item` / `? first-line` — are padded with a **structural two columns** — an indicator character plus its space, `?` or `:` — never the configured `indent`. The reference pads them with the configured indent, and at `indent ≠ 2` its own strict parser then misreads the sequence output (items merge into one scalar) or rejects the mapping output outright. Compact continuation lines must align with the first item, which always begins two columns in; any other pad silently re-nests or corrupts the value on reparse. The house [fidelity obligation](../formatter-convention.md#decision-5--the-fidelity-obligation) says our emit must reparse to the same document, so where the oracle contradicts its own parser we follow the spec and record the divergence rather than reproducing the bug.

Nine byte-pinned fixtures under `__test__/fixtures/explicit-key/` pin the emit, including both sides of the 1024/1025 boundary. They were authored **once** against `yaml@2.9.0` as a strict oracle in a scratch directory outside the repo, with provenance recorded in that directory's `ORACLE.md`; the committed bytes are the contract thereafter and the reference package is not a dependency of the test run.

### `lineWidth` — value-path-only by contract

A positive `lineWidth` folds long **plain**, **double-quoted** and **block-folded** scalars at approximately that column, inserting only semantically transparent breaks — ones a reader folds back to a single space, so the round-trip is preserved. **Block-literal and single-quoted scalars are never folded**: literal blocks preserve their bytes by definition, and single-quoted folding is out of scope. The folding functions live in `internal/fold.ts`. Flow-collection items pass `allowFold=false`, because they are re-joined with spaces and a fold break would corrupt them.

The default is `0` — never wrap — and as with `indentSequences` the default is the decision. It is what keeps default output byte-identical and the compliance harness at 100%: nothing folds unless a caller asks.

**Value-path-only is the documented contract, not a gap** ([issue #105](https://github.com/spencerbeggs/effected/issues/105)). Only `Yaml.stringify` and `Yaml.stringifyResult` fold. The document and node path threads `lineWidth` into its render context but never reads it, and the schema factories encode with default stringify options, so neither ever folds. The TSDoc states the boundary and steers node-path callers to `Yaml.stringify(doc.toValue(), options)`, and a regression test pins the node path's inertness — so folding cannot land there without failing that test and rewriting the docs with it.

## Multi-document support

A yaml-specific surface with no jsonc analog. YAML's `---`/`...` document-stream model gets first-class support at both the value and document layers. This is genuinely yaml's own concern — anchors, aliases, pairs-versus-properties, multi-document — and no shared tree abstraction is extracted across jsonc and yaml: the trees differ enough that a shared abstraction would be premature and leaky.

## Equal and Hash semantics

Structural `Schema.TaggedClass` equality is load-bearing for the visitor and AST tests and works as designed; no node customizes `[Equal.symbol]`, so the `[Hash.symbol]` obligation never arises. `Yaml.equals`/`equalsValue` implement the *semantic* relation — comment- and format-ignoring, alias-resolving — which is different, so they stay explicit statics. Any recorded parse error, or a duplicate-key warning, on either side yields `false`: malformed input is never equal to anything, including itself.

Should a node ever customize `[Equal.symbol]`, it MUST override `[Hash.symbol]` too, since `Equal.equals` fast-paths on hash mismatch.

## Internal construction

The house rule is `X.make(...)`, never `new X(...)`. The engine is the **recorded exception**: it retains `new` for AST construction on the hot recursive composition path, where nodes are trusted (built from validated CST) and per-node `make` validation is exactly the hot-path cost the observability posture already refuses to pay. All public surface, tests and doc examples use `make`.

`new` on a v4 tagged class still **validates structurally** — explicit `undefined` for an `optionalKey` field throws even with `{ disableChecks: true }`, which only skips refinement checks. The engine's `new` sites therefore use conditional spreads for every optional field.

## Observability

Named `Effect.fn` spans at public *fallible* boundaries only — parse, stringify and modify at the facade, document and format layers. Pure synchronous operations are not instrumented, there is **no per-node instrumentation inside the composer** (a hot recursive path), and internal helpers get no spans. The visitor carries no span: stream construction is lazy and pure, with no clean `Effect.fn` boundary. The library is telemetry-agnostic.

## No services

A pure-tier library needs none — class statics suffice, and a codec adapter is the consumer's layer. `src/` defines no `Context` and no `Layer`. [`config-file`](config-file.md)'s `ConfigCodec` interface is exactly the `Yaml` facade shape, so its `YamlCodec` adapter is one file; the codec lives there, not here, because the dependency arrow points *at* yaml, never from it.

## Fixture corpus and compliance harness

The vendored yaml-test-suite is committed as plain files (nested `.git` stripped) under `__test__/fixtures/yaml-test-suite/`, pinned to a recorded upstream ref — deterministic, offline and Turbo-cacheable, with no fetch-on-test dependency. The harness is the regression safety net: an e2e suite covering parse success/failure, JSON equivalence, canonical-output byte equality and round-trip. It must stay at 100% (1226/1226) with empty skip maps, and it is a **ratchet in both directions** — a number that rises means a fixture's assertion changed, which is as much a failure as one that falls.

The same corpus carries a second e2e suite: **token position fidelity**. Every token of every fixture must tile the source — ordered, non-overlapping, `text.slice(offset, offset + length)` equal to the token's `text`, and every gap between consecutive tokens horizontal-whitespace-only. It is the invariant the whole lint layer rests on, since every diagnostic position and every autofix span is a token position, and tiling (rather than slice-equality alone) is what proves the stream *covers* the source instead of merely quoting correctly where it speaks. ~6.4k tokens today, with a floor assertion so a silently-empty walk cannot pass as green.

## Testing

`@effect/vitest` with `it.effect` as the default mode, split per concept under `__test__/` with the two compliance suites in `__test__/e2e/` and the lint rule suites under `__test__/rules/`. Construct via `X.make(...)`. 19 test files, ~1600 tests.

Beyond the behavior-contract suites, three families are structural: property tests via `it.effect.prop` with `Schema.toArbitrary` on the AST classes (round-trip and format idempotence — pattern-field checks use lookahead-free regexes so derivation works), diagnostic-position tests pinning `line`/`character` computation and the fatal-code predicate, plus structure-preserving-error tests asserting that failures carry diagnostic arrays rather than reason strings.

The lint rules add a fourth: a **shared fixture harness** (`__test__/rules/harness.ts`) taking each fixture as input → expected diagnostics → expected fixed output, so thirteen rules cannot drift into thirteen dialects of "tested". Two guards ride on it. Every fixture input must **parse cleanly** unless it declares `expectsParseErrors`, checked **bidirectionally** — a fixture with an accidental syntax error would otherwise test a rule against a document the composer never built, and an unchecked opt-out would decay into a suppression pasted everywhere. And every rule is proven falsifiable by **two automated mutants**: a dead-rule mutant that reports nothing, and an unfixing mutant that reports but declines to fix. The second catches what the first cannot — correct diagnostics with an inert `fix`.

## Comment model

Per-node comments round-trip ([issue #127](https://github.com/spencerbeggs/effected/issues/127), shipped 2026-08-12). This replaced a standing limitation — the composer captured comments the stringifier never re-emitted — and it cost a **public breaking schema change**, because the old single `comment` field carried no leading/trailing discriminator and the composer attributed own-line comments *backward*. Emitting that faithfully was impossible: `# section` above `b:` would have re-emitted as `a: 1 # section`, relocating the comment to the wrong line and construct, which is a worse fidelity bug than dropping it.

**The fields.** `YamlScalar`, `YamlMap`, `YamlSeq` and `YamlPair` each carry `commentBefore` (own-line comment text directly above), `comment` (now strictly **trailing**) and `spaceBefore` (a blank line preceded the node and its `commentBefore` block). `YamlDocument` keeps `comment` as the **leading header** block and gains `commentAfter` for the trailing block — the pre-existing header spelling stays stable rather than being renamed to match the node classes. `YamlAlias` is **deliberately excluded**: the split covers four classes, and a comment attributed to an alias node is dropped.

**Attribution runs forward.** An own-line comment attaches to the *following* pair or item as `commentBefore`; a comment on the same line as the end of a pair or item is that node's trailing `comment`; consecutive own-line comments join with newlines into one run, and blank lines inside a run embed as extra `\n`s. Own-line comments after a collection's last entry become the collection's `comment` when at or beyond its content column and **escape to the enclosing scope** — through multiple levels — when shallower, which is what makes a terminal comment land on the construct a reader would say it belongs to.

**Storage is the raw post-`#` slice.** Alignment spaces, no-space-after-`#` and bare `#` are all preserved byte-faithfully, because normalizing them at capture would make the field lossy for the one job it exists to do.

**Six divergences from the reference `yaml` package are recorded in one place** — the head of `src/internal/composer/comments.ts`. They cover pair-level rather than key/value-node placement, the alias drop, trailing-comment drops on block scalars and multi-line complex keys, flow-layout normalization, pre-`#` spacing normalization and the document field naming. Every one keeps the emitted bytes reparse-stable. Read that header before changing attribution; do not re-derive them.

**Emission and the visitor.** The stringifier emits comments for every node kind in both block and flow styles, including the explicit-key and compact branches. `preserveComments` now delivers what its name promises instead of reaching only the document comment. Canonical mode (`forceDefaultStyles`) is **comment-free** — that is what keeps the e2e harness's byte-equality assertions comparing structure rather than trivia. The visitor's `Comment` event gained `placement: "leading" | "trailing"`, so a SAX consumer can tell the two apart without re-reading the source.

The proof is a fixed point, not a diff: the systems-repo workflow fixture is byte-identical under `YamlFormat.formatToString`. Conformance stayed 1226/1226 across the whole change, including through the composer re-attribution that sits in the path every fixture exercises.

## Lint system

`@effected/yaml` ships a yamllint-class lint system ([issue #129](https://github.com/spencerbeggs/effected/issues/129)): a rule engine whose rule #1 is parse-validity, 14 built-in rules, a rule-aware `YamlLintConfig` with `default` / `relaxed` presets, and surgical autofix that routes only through `YamlEdit.applyAll`.

**Its design doc is [yaml-lint.md](../yaml-lint.md)** and is not duplicated here. Three things matter at this doc's level:

- It stays inside the **pure tier**. No file discovery, no config-file loading, no CLI, no autofix-to-disk — strings in, diagnostics or a fixed string out. The runner is a consumer's tier.
- It **adds no parser**. Rules read the one materialized token array, the composed document and the source lines; the engine tokenizes and composes once per run.
- Autofix is **not** `format`. Fixes are surgical `YamlEdit`s, never a reflow — a structural test asserts `YamlLint.ts` does not import `YamlFormat`.

## Build

All class factories are written inline with no exported `*_base` const; the synthesized `_base` heritage symbols — including the co-recursive AST bases and the visitor-event union — are suppressed narrowly in `savvy.build.ts` and land in the `issues.json` `suppressed` bucket, keeping it zero-warning. Never widen the suppression. The `Schema.suspend` callbacks' own return-type annotations survive where recursion requires them, and genuinely reusable public schemas stay `@public` on their own merit. The api-extractor model is wired at `website/lib/models/yaml`. Policy: [effect-standards.md](../effect-standards.md#api-extractor--effect-class-factories).
