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
  - jsonc.md
---

# @effected/yaml design

## Overview

Target design for `@effected/yaml`, the third package migration (step 2 of [migration-playbook.md](../migration-playbook.md), playbook target #3 after semver and jsonc). Source is yaml-effect (`/Users/spencer/workspaces/spencerbeggs/yaml-effect`, v0.7.1, Effect v3); the step-1 analysis lives in `.claude/reviews/yaml.md` and this design implements its §3 v4-mapping, §4 layout, §5 seams and §6 tier findings against [effect-standards.md](../effect-standards.md). Like the semver and jsonc ports this is a redesign, not a lift-and-shift: the layered lex→CST→compose→value pipeline, the "Schema IS the class" AST, the edits-not-mutations model, the warnings-as-data recoverable-parse design, the 1,226-assertion compliance harness and the string→domain schema DX all survive; the ~45 floating functions, the 24+11 guard functions, the public `*Base` ceremony, the dead error quartet, the thrice-duplicated fatal-code lists, the structure-losing string error wrapping, the `RawFormatOptions` triplication and the `makeYaml*` factory naming do not.

`@effected/jsonc` ([jsonc.md](jsonc.md)) is the primary template for this port — yaml-effect is a near-isomorph of jsonc-effect (review §5), so the [jsonc/yaml parity convention](jsonc.md#jsoncyaml-parity-convention) is a **binding migration requirement** here, not a nicety. Every shared-vocabulary concept (`Edit`, `Range`, `Path`, `Segment`, `FormattingOptions`, the parse-error-detail-with-position shape) MUST be structurally identical to its `Jsonc*` counterpart; the reconciliation of the two error-detail shapes is worked through in [jsonc/yaml parity reconciliation](#jsoncyaml-parity-reconciliation) below.

Status: **implemented on `feat/yaml-migration` (playbook steps 3–6 complete).** The open decisions the review left standing were resolved as recorded below, and the carry-forward learnings from the semver and jsonc migrations were adopted as house policy from the start. The port landed with all gates green: **1,331 tests passing** (the 1,226-assertion compliance harness intact at 100% with EMPTY skip maps, plus 105 per-concept unit tests), `pnpm typecheck` clean, biome clean, and a zero-warning `dist/prod/issues.json` from `turbo build:prod`, with the api-extractor model wired at `website/lib/models/yaml`. This doc records the *as-built* design; per the semver/jsonc precedent it is promoted to `current` with a raised completeness and inline "As-built:" deviation notes woven into the sections below. The scale of the port (~14,200 lines of source, `composer.ts` alone 4,967 lines, 25 test files) made the [port strategy](#port-strategy) — engine-first, compliance-verified, construction-sites-migrated-incrementally — load-bearing, and it held.

## Tier and dependencies

Pure tier — no IO anywhere, confirmed by review §6. All inputs are strings; all outputs are values, documents, edits, streams or domain errors; even the visitor streams are pure. `peerDependencies`: `effect` only (`catalog:effect`). `devDependencies`: `effect` and `@effect/vitest` (both `catalog:effect`). Peer closure is trivially complete: `effect` has no peers of its own, so the systems#228 / vitest-agent#127 escape mode cannot occur here. No `@effect/platform*` imports, no `node:` imports — the v3→v4 platform merge is a non-event for this package (review §6 verified runtime imports in `src/` are `"effect"` only). No cross-`@effected` edges outbound; `@effected/config-file` will later depend on this package via a one-file codec adapter (review §5, and [consumer seam](#consumer-seam) below), not the reverse. `"sideEffects": false`. Target directory is `packages/yaml`.

## Module layout (module-per-concept)

Per the module-per-concept standard, ~9 public source files plus an internal engine directory, replacing the v3 repo's kind-based `errors/` (9 files) + `schemas/` (10 files) + `utils/` (11-file, 12k-line engine-and-public-API mashup) sprawl (review §2, §4):

- `src/index.ts` — public surface, re-exports only, zero side effects.
- `src/Yaml.ts` — the facade concept. Statics `parse`, `parseAll` (value-level), `stringify`, `stripComments`, `equals`, `equalsValue`, and the flagship schema factories `schema(Target, options?)` / `fromString(options?)` / `allFromString(options?)` plus the `YamlFromString` default-options schema. Owns `YamlParseOptions`, `YamlStringifyOptions`, `YamlParseError`, `YamlStringifyError`.
- `src/YamlDiagnostic.ts` — the structured diagnostic concept (v3's `YamlErrorDetail`, renamed to what it is: it carries both errors *and* warnings-as-data on `YamlDocument`). `YamlDiagnostic` class, the staged code literal unions (lex/parse/compose stages), and the **single** fatal-code predicate — the one source of truth replacing v3's thrice-duplicated, subtly-differing inline fatal lists (review §2).
- `src/YamlNode.ts` — the mutually-recursive AST concept, co-located in one file exactly as v3's `YamlAstNodes.ts` does (the co-location breaks the import cycle; review §1). `YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`, the `YamlNode` union, and the `ScalarStyle`/`CollectionStyle` literal sets. Instance methods replace the 11 AST guards and the floating navigation functions: `find(path)`, `findAtOffset(offset)`, `pathOf(node)`, `toValue(anchors?)`, with `YamlScalar.is(...)`-style static guards where narrowing is still wanted.
- `src/YamlDocument.ts` — `YamlDocument` and `YamlDirective`. Statics `parse(text, options?)`, `parseAll(text, options?)`, `schema(options?)` (replaces `makeYamlDocumentSchema`); instance `stringify(options?)`, `toValue()`. Carries the `errors`/`warnings` `YamlDiagnostic` arrays for the recoverable-parse design.
- `src/YamlEdit.ts` — the text-edit concept. `YamlEdit` (`Schema.Class`) plus static `applyAll(text, edits)` → `string`. Owns the shared edit vocabulary: `YamlRange` and `YamlPath`/`YamlSegment` type aliases (all bound by the parity convention).
- `src/YamlFormat.ts` — the formatting/modification concept. `format(text, range?, options?)` / `formatToString`, `modify(text, path, value, options?)` / `modifyToString`, and `YamlFormattingOptions` (derived from `YamlStringifyOptions` fields — see [options](#options-derivation)). Owns `YamlFormatError`, `YamlModificationError`.
- `src/YamlVisitor.ts` — the AST event concept. The Schema-backed event union and `visit(text, options?)` → `Stream<YamlVisitorEvent>`, plus the `maxAliasCount` DoS guard carried over. **AST-level only** — the CST visitor is internal (see below).
- `src/internal/` — the private engine, ported as-is first (see [port strategy](#port-strategy)):
  - `lexer.ts` — the scanner state machine (v3 `utils/lexer.ts`; v3's public `lex`), and — as-built — the pull-based incremental scanner too (v3's public `createScanner`), now private.
  - `cst-parser.ts` — the CST builder (v3 `utils/parser.ts`; v3's public `parseCST`).
  - `composer/` — the 4,967-line monolith split along its existing internal seams: `state.ts` (state, error recording, fatality filtering), `block.ts`, `flow.ts`, `scalars.ts`, `tags.ts`, `anchors.ts`, `document.ts`.
  - `stringifier.ts` — the emit engine incl. canonical-output logic (v3 `utils/stringify.ts`).
  - `fold.ts` — block/flow scalar folding helpers.
  - `diff.ts` — `computeEdits` text diffing, shared by `format` and `modify`.
  - `equal.ts` — the `deepEqual` primitive behind `Yaml.equals`/`equalsValue`.
  - `cst-visitor.ts` — the CST event union and its stream visitor (v3 `visitCST`/`visitCSTCollect`), now private.

As-built: **there is no separate `src/internal/scanner.ts`.** In v3, `createScanner` *is* the lexer state machine — the pull-scanner and the batch `lexAll` share the same machinery — so both live together in `src/internal/lexer.ts`; the design's `scanner.ts` entry resolved to nothing separable once the port started.

As-built: the composer split landed exactly as designed (`state.ts`/`block.ts`/`flow.ts`/`scalars.ts`/`tags.ts`/`anchors.ts`/`document.ts`) with one refinement. No generic `composeNode` dispatcher was needed — `flow.ts` never calls back into `block.ts`; the only cycle is `block.ts` → `flow.ts`, broken by a `FlowComposers` dispatch record on `ComposerState` that `document.ts` injects. `parseDirective` lives in `tags.ts` (not `document.ts`) because `validateTagHandlesInDocument` needs it there.

Every non-entrypoint module imports explicitly from defining modules; no barrels, no re-export facades.

### CST and lexer layers go internal

**Decision, resolved (overrides review §1's keep-all-four-layers-public recommendation).** The review argued for keeping lex → CST → compose → value all public to serve LSP/tooling consumers. The resolved decision **matches jsonc**: the public surface is the value/document layers plus the AST, the edit/format/modify concepts, the AST-level visitor, and the schema factories. The lexer, CST parser, pull-based scanner and CST visitor all live in `src/internal/`. There is **no public `YamlToken.ts` / `YamlCst.ts`** — the review's proposed token/CST concept modules do not exist as public surface; `YamlToken`/`YamlTokenKind`/`CstNode`/`CstNodeType` and the CST event union are internal types.

Deferral note (mirroring jsonc's tokenizer deferral): a `Stream<YamlToken>` / `Stream<CstNode>` public interface — the Effect-native way to expose token- and CST-level access for LSP tooling — is **explicitly deferred until a consumer materializes**. No speculative public tokenizer/CST surface now. The review's own §5 concurs: the CST/scanner layer is conceivably a separate concern for a language-server project, but "there is no consumer demanding it; keep one package… revisit only if a language-server project materializes." This design makes the same call one level down — keep the layers as *internal* modules, promote them to public surface only when an LSP-tooling consumer exists.

## Effect-wrapping policy (package-wide)

The review flagged v3's habit of wrapping pure, total computation in `Effect.sync` (`findNode`, `findNodeAtOffset`, `getNodePath`, `applyEdits` → `Effect<Option<…>>`), compounded by `Fn.dual` dual-signature machinery on the same lookups. The resolved policy is **jsonc's template verbatim**:

> **Pure synchronous methods where nothing can fail; `Effect` only where the error channel is real; `Stream` for the visitor.**

- **Pure synchronous** (no `Effect`, no `Option`-wrapping of the whole result unless absence is the value): node navigation (`YamlNode.find`, `findAtOffset`, `pathOf`), value extraction (`YamlNode.toValue`, `YamlDocument.toValue`), edit application (`YamlEdit.applyAll`, `YamlFormat.formatToString`/`modifyToString`), the formatting-edit *computation* (`YamlFormat.format` — computing edits never fails), comment stripping (`Yaml.stripComments`), and semantic equality (`Yaml.equals`/`equalsValue`). These are total functions over their inputs; an `Effect<_, never>` wrapper is pure ceremony forcing callers into `yield*` + `Option` handling for no benefit. As instance methods, the `Fn.dual` dual style is moot and disappears.
- **`Effect`** (real typed `E` channel): `Yaml.parse` / `Yaml.parseAll` (fail `YamlParseError`), `Yaml.stringify` / `YamlDocument.stringify` (fail `YamlStringifyError`), `YamlFormat.modify` (fail `YamlModificationError`), and the schema decode path (`Yaml.schema` / `fromString` / `allFromString` decoding). `YamlFormat.format` is pure (edit computation is infallible); only `modify` carries a real error channel (navigation miss / invalid edit).
- **`Stream`** for the visitor: `YamlVisitor.visit` returns `Stream<YamlVisitorEvent>`. Malformed input surfaces as **error events in the union** (mirroring v3's onError semantics), keeping the stream demand-driven and infallible at the type level; `Stream.take` early-termination and the `maxAliasCount` guard are preserved.

Uniform-Effect-everywhere is the defensible alternative; it is rejected for the same reason as in jsonc — the pure/Effect split makes fallible operations legible at the call site (an `Effect` return type *means* "this can produce a domain error") while keeping the flagship pure operations ergonomic.

## Target public API

Class-based DX throughout: the v3 ~45 floating functions collapse to statics and instance methods on the schema classes, the 24+11 guard functions become `_tag` narrowing / `X.is` statics, and the `Fn.dual` ceremony dissolves. The `makeYaml*` factory-prefix naming and the `visitCSTCollect`/`formatAndApply` suffix disambiguation are absorbed by class statics.

### Yaml (facade)

A namespace object of statics over the parser, stringifier and schema layers (class-with-statics per the semver/jsonc precedent, resolving the review §4 open naming question). Not a schema class.

- `parse(text, options?)` → `Effect<unknown, YamlParseError>`. Single-document value parse; error-recovery collects all fatal diagnostics and fails once with the aggregate.
- `parseAll(text, options?)` → `Effect<ReadonlyArray<unknown>, YamlParseError>`. Multi-document value parse (see [multi-document support](#multi-document-support)).
- `stringify(value, options?)` → `Effect<string, YamlStringifyError>`.
- `stripComments(text, replaceCh?)` → `string`. Offset-preserving comment stripping, pure.
- `equals(a, b)` / `equalsValue(a, b)` → `boolean`. Semantic equality (comments/formatting ignored), pure and total.
- `schema(Target, options?)`, `fromString(options?)`, `allFromString(options?)`, and the `YamlFromString` default-options schema — see [schema transformation strategy](#schema-transformation-strategy).
- Owns `YamlParseOptions` and `YamlStringifyOptions` (both `Schema.Class` with bare `optionalKey` fields and implementation-level defaults — see [options](#options-derivation)).

As-built: `Yaml.stripComments` is scanner-based and **total in both modes** — the v3 parse-then-restringify removal mode is gone. Without a `replaceCh`, comment characters are deleted with line breaks kept; with one, offsets are preserved by replacing in place. Pure, total and quote-aware in both branches, closing the three raise sites the dropped `YamlFormatError` used to cover.

As-built: `Yaml.equals`/`equalsValue` harden per the jsonc precedent — any recorded parse error, or a `DuplicateKey` warning, on either side yields `false`. Malformed input is never equal to anything, including itself.

As-built: `Yaml.fromString(options?)` takes **parse** options only; the encode direction uses default stringify options. v3's `makeYamlFromString` second parameter (stringify options for the encode side) is dropped per the design's single-options-parameter signature.

### YamlNode (AST)

The mutually-recursive AST, co-located in one file. Each node is a `Schema.TaggedClass` (v3 already models them this way — the migration is *additive* for the data model, review §1), recursion handled with `Schema.suspend` and no parent pointers (parent pointers would break structural equality, serialization and Schema encode/decode — the same rationale as jsonc's node).

- `YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`; the `YamlNode` union; `ScalarStyle`/`CollectionStyle` literal sets.
- Instance methods replacing the 11 AST guards and the floating navigation quartet: `find(path)` → `Option<YamlNode>`, `findAtOffset(offset)` → `Option<YamlNode>`, `pathOf(node)` → `Option<YamlPath>`, `toValue(anchors?)` → `unknown` (alias-resolving — see below). Absence stays `Option`, never a `NotFound` error.
- **`getNodeValue` deduplication (review §2).** v3 ships two `getNodeValue`s: `utils/ast.ts` (`Effect<unknown>`, no alias resolution) and `utils/composer.ts` (sync, alias-resolving). Both fold into the single instance method **`YamlNode.toValue(anchors?)`** — sync, alias-resolving, with the anchor map threaded as the optional argument. The duplicate name/signature disappears.
- Construct via `YamlScalar.make(...)` etc. in public surface, tests and doc examples — never `new` (see [internal construction](#internal-construction-new-vs-make)).

As-built: the fold landed exactly as designed — `YamlNode.toValue(anchors?)` is the single method — but `internal/anchors.ts` keeps a one-line delegating `getNodeValue` for engine/harness callers that still expect a free function.

As-built: `YamlNode.pathOf(node)` is **reference-identity based** — it walks the tree looking for the given descendant node by identity and returns the path to it, the inverse of `find`. Complementing `findAtOffset(offset)`, this covers the role v3's offset→path function played (compose the two: `findAtOffset` then `pathOf`).

As-built value-extraction discipline: `Yaml.parse` uses the incremental-empty-anchor-map discipline (aliases resolve to the most recently seen anchor at the point of use — v3's single-document parse semantics), while `Yaml.parseAll` uses `buildAnchorMap` per document (the v3 compliance-harness multi-document semantics, where each document's anchors are independent).

As-built hardening: `__proto__` mapping keys become own data properties via `Object.defineProperty` in `YamlNode.toValue`, closing the prototype-pollution footgun a naive `obj["__proto__"] = value` assignment would open.

### YamlDocument

`YamlDocument` (`Schema.Class`) and `YamlDirective`. Carries `errors`/`warnings` arrays of `YamlDiagnostic` for the recoverable-parse design (non-fatal issues surfaced as data alongside typed failure for fatal ones — review §1).

- Statics: `parse(text, options?)`, `parseAll(text, options?)`, `schema(options?)` (replaces `makeYamlDocumentSchema`).
- Instance: `stringify(options?)` → `Effect<string, YamlStringifyError>`, `toValue()` → `unknown`.

As-built: `YamlDocument`'s framing flags (`hasDocumentStart`/`hasDocumentEnd`/`hasDocumentStartTab`) are bare `optionalKey` booleans with an implementation-level `?? false`, matching the [options derivation](#options-derivation) idiom. `YamlDocument.schema` targets `Schema.instanceOf(YamlDocument)` as its `decodeTo` destination rather than the class itself — a v4 fact: `Schema.decodeTo(Class)` expects the transformation to produce the class's *encoded* struct, not instances, so `instanceOf` is the correct decode target for a schema that yields `YamlDocument` instances.

### YamlEdit

`Schema.Class` holding `offset`, `length`, `content` (the shared edit vocabulary). Static **`applyAll(text, edits)`** → `string` applies edits in reverse-offset order (byte-minimal, comment/whitespace-preserving — the library's real differentiator, review §1). The static is named `applyAll` to match `JsoncEdit.applyAll` — the review's proposed `YamlEdit.apply` name is rejected because it loses parity. Owns `YamlRange` (`Schema.Class`: `offset`, `length`) and the `YamlPath` (`ReadonlyArray<YamlSegment>`) / `YamlSegment` (`string | number`) type aliases, all bound by the parity convention.

### YamlFormat

- `format(text, range?, options?)` → `ReadonlyArray<YamlEdit>` (pure — computes edits, never fails).
- `formatToString(text, range?, options?)` → `string` (`applyAll ∘ format`). Sole survivor of v3's `formatAndApply`.
- `modify(text, path, value, options?)` → `Effect<ReadonlyArray<YamlEdit>, YamlModificationError>`. `value === undefined` means delete; insertion appends after the last pair/element. Owns `YamlModificationError`.
- `modifyToString(text, path, value, options?)` → `Effect<string, YamlModificationError>` (`applyAll ∘ modify`). Sole survivor of v3's `modifyAndApply`.
- `YamlFormattingOptions` — see [options derivation](#options-derivation).

**Structure-preserving errors (review §2, house rule).** v3's `format`/`modify`/`stringify` collapse rich upstream failures into `reason: string` (`new YamlFormatError({ text, reason: e.message })`), discarding `YamlErrorDetail` positions and violating "never collapse errors to string early." The redesign **carries `YamlDiagnostic` arrays through**: `YamlModificationError` and `YamlStringifyError` carry structured `diagnostics: ReadonlyArray<YamlDiagnostic>` payloads, never preformatted reason strings — as-built, `YamlFormatError` itself is dropped (see the [error set](#error-set-derived-from-raise-sites) as-built note); `format` is pure and never raises.

As-built: `format`/`modify` additionally accept a positional `range` typed as `YamlRangeLike` (`YamlRange | { offset; length }`) rather than requiring a `YamlRange` instance — `RawFormatOptions` stays deleted, as designed, but the plain-object convenience moves onto the `range` parameter itself rather than a separate raw options shape.

### YamlVisitor

- `visit(text, options?)` → `Stream<YamlVisitorEvent>`, wrapping the generator with `Stream.fromIterable` (demand-driven, `Stream.take`-friendly). The event union is **Schema-backed** (`Data.taggedEnum` per the jsonc precedent, or a `Schema.Union` of tagged events) rather than v3's plain object literals — making events serializable and consistent with the library. Begin/pair/scalar events carry `path` context; malformed-input error events are part of the union. The `maxAliasCount` DoS guard carries over.
- `visitCollect` is **dropped** — `Stream.filter` + `Stream.runCollect` cover it (v4's `Stream.runCollect` returns `Effect<Array<A>>` directly, no `Chunk.toReadonlyArray` step). The review rates the convenience marginal; the CST-visitor equivalents (`visitCST`/`visitCSTCollect`) go internal wholesale.

As-built: the event union is `Data.taggedEnum` with **12 variants** (v3's "Event" suffix dropped per the jsonc precedent), including a **new `Error` variant** carrying a materialized `YamlDiagnostic`. `visit` is infallible by design: every composer diagnostic — errors, warnings and stream-level directive errors — surfaces as an `Error` event rather than failing the whole stream, the opposite of v3's fail-the-whole-stream-on-error semantics. `maxAliasCount` needed no visitor-side code of its own; the composer's existing guard surfaces through `Error` events for free. No span on `visit` — deferred, per the jsonc precedent (see [observability plan](#observability-plan)).

## Schema transformation strategy

Mirrors jsonc's flagship arrangement (which mirrors semver's `SemVer.FromString` + factory-statics):

- `Yaml.YamlFromString` — a `Schema<unknown, string>` transformation (`Schema.String.pipe(Schema.decodeTo(...))`) using the parser with the *default* `YamlParseOptions`. The zero-config entry point, pre-bound singleton.
- `Yaml.fromString(options?)` — a factory returning a `Schema<unknown, string>` bound to the supplied options; `YamlFromString` is definitionally `Yaml.fromString()` with defaults.
- `Yaml.allFromString(options?)` — the multi-document factory, returning a `Schema<ReadonlyArray<unknown>, string>`. Yaml-specific, no jsonc analog (see [multi-document support](#multi-document-support)).
- `Yaml.schema(Target, options?)` — composes `fromString(options)` with a target `Schema` (v4 pipe-composition of codecs), yielding the `Schema<A, string, R>` pipeline that is the single best consumer-facing feature (review §1). The **`R`-polymorphic signature `Schema.Schema<A, string, R>` is preserved** — the review rates it good design. `@effected/config-file`'s codec call site collapses directly into this (review §5).

The two `as unknown as Schema.Schema<…>` casts in v3's `makeYamlAllFromString`/`makeYamlDocumentSchema` die in the redesign (review §3).

**Boundary discipline (standards + jsonc/semver precedent).** A `Schema` cannot fail with a domain error. The `Schema.decodeTo` transformation fails with a `SchemaError` carrying a `SchemaIssue.InvalidValue` whose message is the aggregate parse message (with the line/column enrichment from v3 preserved); the *domain* `YamlParseError` is constructed directly by the `Yaml.parse` / `parseAll` path (which drives the internal composer and bypasses `Schema` entirely). Consumers wanting the domain error from a schema pipeline normalize at the boundary with `Effect.catchTag("SchemaError", …)` — the same shape semver and jsonc ship. `SchemaError` never escapes as the documented contract of `parse`/`parseAll`; it is reachable only through the raw schema decode path.

**Memoization-by-reference caveat (recorded per the jsonc precedent).** `Yaml.fromString(options)`, `allFromString(options)` and `schema(Target, options)` are schema-*producing* functions — each call returns a fresh schema instance, and v4 schema derivation caches (`toArbitrary`, `toEquivalence`, decode-plan memoization) key by reference and will *not* be shared across calls with structurally-equal options. Hot-path consumers should bind the produced schema to a `const` once. `YamlFromString` is the pre-bound singleton so the common default-options case needs no such discipline. Document this on every factory static.

## Error set (derived from raise sites)

Enumerated from actual construction sites in the v3 source (review §2 counted them), not the export list. v3 exports eight error classes but constructs only four: `YamlComposerError` (4 sites), `YamlFormatError` (6), `YamlModificationError` (3), `YamlStringifyError` (2). The other four — `YamlLexError`, the *old* `YamlParseError`, `YamlNodeNotFoundError`, `YamlSchemaError` — are never raised anywhere in `src/`.

**Error consolidation (resolved, review §3/§4).** The user-facing parse failure is misnamed `YamlComposerError` (an internal pipeline-stage name) while a dead `YamlParseError` occupies the good name and is misleadingly documented as "`parseCST` may fail with this error" (`parseCST` actually returns `Stream<CstNode, never>`). Resolution: **rename `YamlComposerError` → `YamlParseError`** (the dead class frees the name), **delete the four never-raised classes**, and keep stage discrimination in `YamlDiagnostic.code`. The surviving four errors:

| Error | Raised by | Payload |
| --- | --- | --- |
| `YamlParseError` | `Yaml.parse` / `Yaml.parseAll` / `YamlDocument.parse` / `parseAll`; `YamlFromString` / `fromString` / `allFromString` / `schema` decode | `diagnostics: ReadonlyArray<YamlDiagnostic>`, `input: string` |
| `YamlStringifyError` | `Yaml.stringify` / `YamlDocument.stringify` | `diagnostics: ReadonlyArray<YamlDiagnostic>`, plus the offending value context |
| `YamlModificationError` | `YamlFormat.modify` (navigation miss / invalid edit) | `path: YamlPath`, `diagnostics: ReadonlyArray<YamlDiagnostic>` |

Each is a `Schema.TaggedErrorClass` with structured payloads and a `message` getter derived from the fields — **never** preformatted strings, and **never** collapsed to a `reason: string` (the v3 sin). `YamlDiagnostic` is already a `Schema.Class`, so error payloads are serializable for free (review §3).

As-built: **`YamlFormatError` is dropped entirely.** The raise-site rule resolved it — of v3's six raise sites, three were in `stripComments`' removal mode (superseded; see the [`Yaml` facade](#yaml-facade) as-built note) and three were in `format`'s parse/stringify error mapping. `format` is pure and returns `[]` (no edits) on input whose parse has fatal errors, so it never corrupts a malformed document and never needs a fallible path. This resolves the verify-at-port-time item the design left open.

As-built: two staged code unions were **added** beyond the lex/parse/compose stages so errors carry `diagnostics` arrays instead of reason strings, mirroring the table above: `YamlStringifyErrorCode = ["CircularReference"]` (the stringifier's only failure mode, thrown internally as `StringifyFailure` and materialized by the facade into `YamlStringifyError`) and `YamlModifyErrorCode = ["EmptyDocument", "PathNotFound", "InvalidIndex", "NotNavigable"]` (`YamlFormat.modify`'s navigation failures, carried in `YamlModificationError.diagnostics`).

### YamlDiagnostic — single source of truth

v3's `YamlErrorDetail` renames to **`YamlDiagnostic`** because it is used for both errors *and* warnings-as-data on `YamlDocument` (review §4). It owns the staged code literal unions (the lex/parse/compose-stage code sets, replacing `YamlLexErrorCode`/`YamlParseErrorCode`/`YamlComposerErrorCode`) and — critically — **a single fatal-code predicate**, the one source of truth replacing v3's thrice-duplicated, subtly-differing inline fatal lists (`parseDocument`, `parseAllDocuments`, `composeDocumentFromCst` each inlined a hardcoded `e.code === "UndefinedAlias" || …` filter, and the three lists *differ* on `MalformedFlowCollection`/`TabIndentation` presence — drift waiting to happen, review §2). Fatality is declared once, as a property of the code.

As-built: the single fatal-code predicate is the union of v3's three inline lists (nine codes) plus two hardening additions — `UnexpectedCharacter` and `NestingDepthExceeded` (see the port-time hardening note below). No compliance case regressed from unioning the three lists, confirming the drift the review flagged was indeed accidental, not semantically load-bearing.

As-built hardening (beyond v3, all covered by tests, compliance unaffected): (a) raw C0 control characters (other than tab/LF/CR) anywhere in a document's span are fatal `UnexpectedCharacter`, scanned once per document in `composeDocument` per YAML 1.2 §5.1 c-printable; (b) nesting depth is capped at `MAX_NESTING_DEPTH = 256` in the composer (fatal `NestingDepthExceeded`, single diagnostic) and 264 in the CST parser (flat error node, set above the composer's cap so the composer's user-facing diagnostic always fires first) — the uncapped engine overflowed the stack at roughly 900 nesting levels.

**Cycle-avoidance ownership (carry-forward learning applied).** `YamlParseError` is owned by the `Yaml` facade, but the internal composer must not import it, or `Yaml.ts → internal/composer/… → Yaml.ts` becomes an import cycle (`noImportCycles` is error-level — the exact hazard that forced `SemVer.diff` to be dropped and shaped jsonc's parser firewall). Resolution, mirroring jsonc's grammar: **the internal engine returns plain results plus raw diagnostic records (`{ code, offset, length }`); the facade materializes `YamlDiagnostic` (computing `line`/`character` from `offset` against the source text) and constructs the aggregate `YamlParseError` itself.** The composer depends on nothing in `Yaml.ts`; the facade depends on the composer. `YamlDiagnostic` and its code unions live in `YamlDiagnostic.ts` because that is where diagnostics are materialized — the facade and document import from there, the engine emits raw records.

As-built: raw engine diagnostic records also carry `message` alongside `{ code, offset, length }` — the message is engine-authored text, and the facade adds only `line`/`character` on top of it when materializing `YamlDiagnostic`. The `YamlNode`↔`Yaml.ts` cycle check verified clean: `YamlNode.ts` imports only `effect` and `YamlEdit.ts` types, no back-edge into `Yaml.ts`.

## jsonc/yaml parity reconciliation

The [jsonc/yaml parity convention](jsonc.md#jsoncyaml-parity-convention) requires `YamlEdit`, `YamlRange`, `YamlPath`, `YamlSegment`, `YamlFormattingOptions` and the parse-error-detail-with-position shape to be **structurally identical** to their `Jsonc*` counterparts — same field names, types, optionality, and semantics for `applyAll`/`equals`/`equalsValue`/`schema`/`fromString`. Two v3 yaml shapes diverge from jsonc and must be reconciled:

- **Error-detail core.** `JsoncParseErrorDetail` uses `code`/`offset`/`length`/`line`/`**character**`; v3 yaml's `YamlErrorDetail` uses `**column**` (not `character`) and adds a `message` field. **Resolution: `YamlDiagnostic` adopts the `line`/`character` naming** (renaming `column` → `character`), keeping the identical five-field core, with any extra fields (`message`, and `severity` if the warnings-vs-errors distinction needs it) **additive on top of** the identical core. The shared core is codec-generic; the extras are yaml's own.
- **Edit-application static name.** `applyAll`, not the review's `apply` — as above.

The point (from jsonc's convention) is codec-generic consumer code: one function over "a document codec's Edit/Range/Path" that works against both `@effected/jsonc` and `@effected/yaml`. Implementing yaml against these shapes is the pre-work for a later `@effected/text-edit` micro-kernel extraction — **deferred** until both ports land (review §5, [package-inventory.md](../package-inventory.md)). The extraction becomes a mechanical lift once two callers prove the shapes identical.

As-built: `Edit`/`Range`/`Path`/`Segment` and the diagnostic-core parity all hold exactly as designed. `YamlFormattingOptions` is the one exception — see the [options derivation](#options-derivation) as-built note below, which supersedes the parity list for that single type: it is deliberately **not** structurally identical to `JsoncFormattingOptions`.

### Options derivation

**Decision, resolved (review §2's options-triplication fix).** v3 has three near-identical shapes for one formatting concept: `YamlFormattingOptions` (`Schema.Class`) hand-duplicates all seven `YamlStringifyOptions` fields (acknowledged `Schema.extend` workaround), then `RawFormatOptions` (plain interface) mirrors it *again* because the `Schema.Class` `range` field demands a `YamlRange` instance. Resolution:

- **`YamlFormattingOptions` derives its shared fields from `YamlStringifyOptions`** via v4 field combinators (`pick`/`extend`-style) instead of hand-duplication, adding only `range` + `preserveComments`.
- **`RawFormatOptions` is deleted** — `range` accepts a plain `{ offset, length }` via the schema, so no separate raw shape is needed.
- Both options classes (`YamlParseOptions`, `YamlStringifyOptions`, `YamlFormattingOptions`) use **bare `optionalKey` fields with implementation-level `?? default`** rather than v4 constructor/decoding-default wrappers — the jsonc as-built idiom, which keeps the `@public` base annotations tractable (default-wrapper forms complicate the factory-return-type annotation the same way self-referential nodes do). Every default contract survives unchanged.

The `stringify` signature's awkward `YamlStringifyOptions | Partial<ConstructorParameters<…>[0]>` union (leaking constructor mechanics, review §2) collapses to a single `YamlStringifyOptions?` parameter.

As-built: `YamlFormattingOptions` derives its shared fields **at runtime by spreading `YamlStringifyOptions.fields`** (v4 classes expose `.fields`), adding `preserveComments` and `range` on top. The `@public` base annotation references the spread fields' types explicitly (`(typeof YamlStringifyOptions.fields)["indent"]` etc.) rather than through a type-level intersection of the fields record, because the latter didn't produce a clean zero-warning annotation. `format`/`modify` additionally accept a positional `range` as `YamlRangeLike` (`YamlRange | { offset; length }`); `RawFormatOptions` stays deleted, as designed. **This means `YamlFormattingOptions` is deliberately not structurally identical to `JsoncFormattingOptions`** — the runtime field-spread mechanics differ from jsonc's hand-derived shape even though the field *names* and semantics line up. This supersedes the parity list in [jsonc/yaml parity reconciliation](#jsoncyaml-parity-reconciliation) for this one type; `Edit`/`Range`/`Path`/`Segment`/diagnostic-core parity all still hold.

## Multi-document support

Yaml-specific surface with **no jsonc analog** — the parity convention binds only the shared vocabulary, not this. YAML's `---`/`...` document-stream model gets first-class support:

- `Yaml.parseAll(text, options?)` → `Effect<ReadonlyArray<unknown>, YamlParseError>` and `Yaml.allFromString(options?)` schema factory.
- `YamlDocument.parseAll(text, options?)` → `Effect<ReadonlyArray<YamlDocument>, YamlParseError>` and the single-document `YamlDocument.parse` / `schema` statics; instance `stringify`/`toValue`.

This is genuinely yaml's own concern (anchors, aliases, pairs-vs-properties, multi-document) and the review §5 warns *against* extracting a shared tree/document abstraction across jsonc and yaml — the trees differ enough that a shared abstraction would be premature and leaky. Multi-document surface stays yaml-only.

## Equal and Hash semantics

`Schema.TaggedClass` structural equality is load-bearing for the visitor/AST tests (`Equal.equals` on nodes) — verify v4 tagged-class equality semantics before porting assertions (review §3). `Yaml.equals`/`equalsValue` implement *semantic* equality (comment/format-ignoring, alias-resolving) distinct from structural `Equal.equals`, so they stay explicit statics over `internal/equal.ts` rather than leaning on derived instance equality.

Carry-forward learning applied: **if any class customizes `[Equal.symbol]`, it MUST override `[Hash.symbol]` too** — `Equal.equals` fast-paths on hash mismatch, so overriding equality alone silently fails (the semver `SemVer` hook, the jsonc guardrail). Structural equality is expected to be correct for the AST nodes, so this is a guardrail to check during the port, not a planned customization; if any node ends up customizing equality (e.g. for alias-transparent comparison), the hash override is mandatory and gets a regression test pinning hash agreement.

As-built: v4 tagged-class structural equality is confirmed working as designed and is exercised directly by the AST/visitor test suite; no node ended up customizing `[Equal.symbol]`, so the `[Hash.symbol]` override obligation never came into play.

## Observability plan

v3 has zero instrumentation. Per the observability standard, `Effect.fn("name")` at public *fallible* operation boundaries only: `Yaml.parse`, `Yaml.parseAll`, `Yaml.stringify` (and `YamlDocument.parse`/`parseAll`/`stringify`), `YamlFormat.modify`, `YamlFormat.format` *if* it retains a fallible path, and the schema decode entry (`Yaml.schema` / `fromString` / `allFromString` decoding). Pure synchronous operations (`stripComments`, `equals`/`equalsValue`, `YamlNode.find`/`findAtOffset`/`pathOf`/`toValue`, `YamlEdit.applyAll`, the `format` edit computation) are **not** instrumented — consistent with the wrapping policy: no `Effect`, no span.

**Explicitly NO per-node instrumentation inside the composer** (review §3's warning — the composer is a hot recursive path; `Effect.fn` per-node would wreck it). Internal lexer/composer/stringifier/scanner helpers get no spans. `YamlVisitor.visit` gets **no** span for now — the named stream-constructor span is **deferred** exactly as in jsonc (stream construction is lazy and pure; there is no clean `Effect.fn` boundary to attach a span to without forcing the stream into an effect it does not otherwise need). The library stays telemetry-agnostic — no OTel configuration anywhere; applications compose `@effect/opentelemetry` at the edge.

As-built: instrumentation landed exactly as designed — `Effect.fn` on `Yaml.parse`/`parseAll`/`stringify`, `YamlDocument.parse`/`parseAll`/`stringify`, and `YamlFormat.modify`/`modifyToString`. `YamlFormat.format` confirmed pure (no fallible path survived — see the [error set](#error-set-derived-from-raise-sites) as-built note), so it carries no span. `YamlVisitor.visit` stays unspanned, deferred as designed.

## No services

Review §6 confirms yaml-effect defines **zero** services — no `Context`, no `Layer` anywhere in `src/`. Nothing to convert, and the design does **not** invent one: a pure-tier library needs none (class statics suffice; a config-file-style codec adapter is the consumer's layer). The review is explicit — "the answer should be no for a pure library."

## API Extractor bases (house policy)

Ratified 2026-07-07 (semver commit 5f854fb), applied from the start. Every Effect class factory gets a named, exported `X_base` const with an **explicit factory-return-type annotation**, tagged **`@public`**, re-exported from `index.ts`, each carrying a "not meant to be referenced directly" doc comment: `Schema.TaggedClass` for `YamlScalar`/`YamlMap`/`YamlSeq`/`YamlPair`/`YamlAlias` and the visitor events; `Schema.Class` for `YamlDocument`, `YamlDirective`, `YamlDiagnostic`, `YamlEdit`, `YamlRange`, `YamlParseOptions`, `YamlStringifyOptions`, `YamlFormattingOptions`; `Schema.TaggedErrorClass` for `YamlParseError`, `YamlStringifyError`, `YamlModificationError` (`YamlFormatError` is dropped — see the [error set](#error-set-derived-from-raise-sites) as-built note); any `Schema.Union`/`TaggedEnum` base for the visitor event union. Any schema helper const referenced by those annotations (field schemas, literal sets, the code unions) is likewise `@public` with the same note — silk's binary release-tag policy propagates.

**The mutually-recursive AST is the heavy case for this idiom.** Per the updated `effect-api-extractor-bases` skill, the recursive/mutually-recursive node classes annotate their self-references (and each other's cross-references) as **`Schema.Schema<Self>`** — copying the factory return type verbatim is TS2506 (the class references itself through its own base's annotation), and `Schema.Codec<Self>`-style forms fail because `Encoded` (plain struct) differs from `Type` (class with methods). `Schema.Schema<Self>` is the tractable form (lazy, type-only, zero-warning `issues.json`), proven on jsonc's `JsoncNode_base`; yaml's five co-recursive nodes plus the union will exercise it heavily. Ordering rule applies: a base whose fields reference another class in the same file must be declared *after* that class — the co-located `YamlNode.ts` needs careful declaration ordering across the five node classes and the union. Target is a zero-warning `dist/prod/issues.json`. Idiom and worked example: `plugin/skills/effect-api-extractor-bases/SKILL.md`.

## v4 API drift to verify early

The semver port was burned mid-way when v4 removed `SortedSet`; the discipline is to verify the exposed v4 surface *before* committing, not after. Facts already verified during the jsonc port and adopted here as house knowledge:

- **No `ParseResult` module in v4.** Schema transformations use `SchemaTransformation.transformOrFail` via `Schema.decodeTo`, failing with `SchemaIssue.InvalidValue` (not a `ParseResult` failure). The v3 `new ParseResult.Type(ast, input, msg)` construction in `schema-integration.ts` is replaced accordingly; the line/column message enrichment is kept.
- **`Stream.runCollect` returns `Effect<Array<A>>`** — no `Chunk` intermediary, so the `visitCollect`/`visitCSTCollect` `Chunk.toReadonlyArray` step vanishes.
- **`Data.taggedEnum`** suits the visitor event union.
- `Schema.Literals` / `optionalKey` / `suspend` / `decodeTo` / `TaggedErrorClass` shapes confirmed; `Schema.Schema.Type<typeof X>` → `typeof X.Type`.

Remaining drift to verify **at port time** (whatever the composer/stringifier/scanner internals touch beyond the above): the v4 `Stream` surface the lexer/CST/visitor streams use (`fromIterable`/`fromEffect`/`filterMap`/`take`/`filter`/`runCollect`), v4 tagged-class equality semantics, and the `YamlNode`↔`Yaml.ts` cycle check. These resolve to as-built notes when the port lands.

As-built, verified at port time: **no `Either` export from the effect root** — the `Result` module plus `Effect.result` replace `Effect.either`. `Effect.catchAllDefect` is now `Effect.catchDefect`. `Stream.fromIterable`/`take`/`filter`/`runCollect` all behave exactly as the design predicted, so the lexer/CST/visitor streams needed no rework beyond the `Chunk`-removal already called out above.

## Port strategy

**Engine-first, compliance-verified, construction-sites-migrated-incrementally** (review §3 effort note — the load-bearing sequencing for a 12k-line engine). The mechanical surface (schemas, errors, options, tests) is a few days; the risk is the engine internals, which build AST nodes with `new` constructors and plain-object state everywhere across `composer.ts` / `lexer.ts` / `stringify.ts`.

1. **Port the engine as-is into `src/internal/`** first — lexer, CST parser, composer (split along seams), stringifier, fold/diff/equal, scanner, CST visitor — with construction sites left as `new` for the moment.
2. **Verify against the compliance suite** (the 1,226-assertion harness — the safety net, see [fixture corpus](#fixture-corpus-and-compliance-harness)) before touching the public surface. Green compliance is the gate that makes the aggressive redesign feasible.
3. **Migrate construction sites to `X.make` incrementally**, and build the public schema classes / errors / options / facade on top of the verified engine.

### Internal construction: new vs make

**Deliberate call, recorded.** The house rule is `X.make(...)`, never `new X(...)` — but the review notes *hundreds* of `new YamlScalar({...})` sites across the composer/stringifier. Decision: **the internal engine (`src/internal/`) retains `new` for AST construction on the hot recursive composition path**; those nodes are trusted (built by the parser from validated CST) and the per-node `make` validation overhead is exactly the hot-path cost the observability plan already refuses to pay per-node. **All public surface, tests and doc examples use `X.make`.** This keeps the ergonomic/validating constructor as the public contract while not burdening the engine's hot path — and it makes step 3 of the port strategy a *narrowing* migration (public sites → `make`) rather than an all-or-nothing rewrite. Revisit if `Schema.TaggedClass` in v4 makes `new` unsafe (verify tagged-class `new` semantics at port time).

As-built, the recorded v4 discovery: **`new X()` on a v4 tagged/schema class VALIDATES structurally**, unlike v3 — explicit `undefined` passed for an `optionalKey` field throws even with `{ disableChecks: true }` (that flag only skips refinement checks, not structural validation). The engine's hot-path `new` sites use conditional spreads for every optional field to avoid the throw. Measured construction overhead of the structural validation is roughly 8% — negligible, and stayed within the engine's `new`-retention decision above rather than forcing a rework.

## Consumer seam

`@effected/config-file`'s `ConfigCodec` interface (`{ name, extensions, parse: (raw) => Effect<unknown, CodecError>, stringify }`) is exactly the `Yaml` facade shape, and it currently ships `JsonCodec`/`TomlCodec` but no YAML codec (review §5). `@effected/yaml`'s design makes a **one-file `YamlCodec` adapter trivial** for `@effected/config-file` (pure→pure, `workspace:*`). The codec lives in `@effected/config-file`, **not** in `@effected/yaml` — the dependency arrow points *at* yaml, never from it.

## Deliberately not ported

- **The public lexer / CST / scanner layers** (`lex`, `parseCST`, `createScanner`, `visitCST`, `visitCSTCollect`) — moved to `src/internal/` (see [CST and lexer go internal](#cst-and-lexer-layers-go-internal)); `YamlToken`/`YamlTokenKind`/`CstNode`/`CstNodeType` and the CST event union go internal with them. The `Stream<YamlToken>`/`Stream<CstNode>` public interface is deferred until an LSP-tooling consumer materializes.
- **The ~45 floating functions** — absorbed as statics/instance methods; `Fn.dual` and the overload-object const signatures dissolve.
- **The 24+11 guard functions** (11 AST `instanceof`/tag guards, 24 `is*Event` guards) — replaced by `_tag` narrowing and `X.is` statics on the tag-discriminated Schema unions.
- **The four never-raised error classes** — `YamlLexError`, the old `YamlParseError` (name reclaimed for the renamed `YamlComposerError`), `YamlNodeNotFoundError`, `YamlSchemaError`. `Option` returns are kept for absence (no `NotFound` error).
- **All public `*Base` export pairs** — v3's doubled public error surface stays banned; the API-Extractor base need is met by the documented `@public X_base` house idiom, which is a *different* thing (documented, minimal, not presented as real API).
- **`RawFormatOptions`** and the hand-duplicated `YamlFormattingOptions` fields — replaced by field derivation from `YamlStringifyOptions` and a schema-typed plain-`{offset,length}` `range` (see [options derivation](#options-derivation)).
- **The thrice-duplicated fatal-code lists** — collapsed to `YamlDiagnostic`'s single fatal-code predicate.
- **The duplicate `getNodeValue`** — folded into `YamlNode.toValue(anchors?)` with alias resolution.
- **`visitCollect` / `visitCSTCollect`** — `Stream` combinators suffice; the CST variant goes internal.
- **`formatAndApply` / `modifyAndApply`** — replaced by `YamlFormat.formatToString` / `modifyToString` plus the general `format`/`modify` + `YamlEdit.applyAll`.
- **The `makeYaml*` factory quartet** (`makeYamlSchema`, `makeYamlAllFromString`, `makeYamlDocumentSchema`, and the fourth) — absorbed as `Yaml.schema` / `fromString` / `allFromString` / `YamlDocument.schema` statics; the two `as unknown as Schema.Schema<…>` casts die with them.
- **Structure-losing `reason: string` error wrapping** — errors carry `YamlDiagnostic` arrays through.
- **Any invented `Context.Service`** — pure tier needs none; the review explicitly warns not to invent one (§6).

## Fixture corpus and compliance harness

**Decision, resolved: committed plain files.** The v3 repo vendors the yaml-test-suite as a git checkout *with its own nested `.git`*, which is hostile to a monorepo (Turbo cache inputs, repo size, submodule/subtree friction — review §6 flags it as a pre-port decision). Resolution: **strip the nested `.git` and commit the corpus as plain files** under `packages/yaml/__test__/fixtures/yaml-test-suite/`, pinned to a specific upstream ref recorded in a `README`/metadata file alongside the fixtures. This is deterministic, offline, and Turbo-cacheable — no fetch-on-test network dependency, no submodule ceremony.

The **1,226-assertion compliance harness is the crown jewel** (review §1) — the regression safety net that makes the aggressive redesign feasible. It ports **intact** as an e2e suite at `packages/yaml/__test__/e2e/*.e2e.test.ts` (repo convention for e2e tests), covering the four assertion families: parse success/failure, JSON-equivalence, canonical-output byte-equality, and roundtrip. Green compliance is the gate in the [port strategy](#port-strategy).

## Testing strategy

`@effect/vitest` with `it.effect` as the default mode; never plain `it()` + `Effect.runSync`/`runPromise` (all 25 v3 test files are plain `describe`/`it` + `Effect.runSync` and convert wholesale, the compliance harness especially — review §2). Tests live in `packages/yaml/__test__/` split per concept (`Yaml`, `YamlNode`, `YamlDocument`, `YamlEdit`, `YamlFormat`, `YamlVisitor`, `YamlDiagnostic`) with the compliance harness under `__test__/e2e/`, per repo convention. Construct instances via `X.make(...)`, never `new X(...)` in tests and public examples (the engine's internal `new` sites are the recorded exception — see [internal construction](#internal-construction-new-vs-make)).

- **Property tests via `it.effect.prop`** with `Schema.toArbitrary` on the AST classes (review §3): parse/stringify roundtrip properties (`stringify ∘ parse` agreement, `parse ∘ stringify` idempotence on canonical form), and `applyAll ∘ format` idempotence. Any pattern-field checks introduced use **lookahead-free** regexes so `Schema.toArbitrary` derivation works (the fast-check `stringMatching` constraint the standards call out).
- **The compliance e2e suite** (1,226 assertions) — the safety net; ports intact and is the port-strategy gate.
- **Diagnostic/position tests** pinning `YamlDiagnostic`'s `line`/`character` computation and the single fatal-code predicate (proving the thrice-duplicated v3 lists collapse to one without behavior change).
- **Structure-preserving-error tests**: `format`/`modify`/`stringify` failures carry `YamlDiagnostic` arrays, never `reason` strings.
- **Round-trip / behavior-contract tests**: edits-not-mutations byte-minimality (comments/whitespace preserved), `equals`/`equalsValue` semantic equality, `modify` delete-via-`undefined` and append-after-last insertion, `stripComments` offset preservation, multi-document `parseAll` ordering, alias-resolving `YamlNode.toValue(anchors?)`, and `maxAliasCount` DoS protection.
- **Schema-pipeline tests**: `Yaml.schema(Target)` decode/encode, `allFromString` multi-document decode, and the boundary guarantee that decode failures surface as `YamlParseError` (never `SchemaError`) through the `parse`/`parseAll` contract.

Verify-during-implementation items (v4 `Stream` drift the engine touches, tagged-class equality semantics, tagged-class `new` safety for internal construction, the `YamlNode`↔`Yaml.ts` cycle check, whether `YamlFormat.format` retains any fallible path, and any `Equal`/`Hash` customization) are called out inline in the sections above and resolve to as-built notes when the port lands.

As-built: **1,331 tests passing** — the 1,226-assertion compliance harness intact at 100% with EMPTY skip maps (proving the redesign preserved every assertion family without exception carve-outs), plus 105 per-concept unit tests covering the behavior contracts above. `pnpm typecheck` is clean, biome is clean, and `turbo build:prod` produces a zero-warning `dist/prod/issues.json` with the api-extractor model wired at `website/lib/models/yaml`.

Known limitation, carried over from v3 and verified not a regression: per-node comments (`pair.comment` etc.) are captured by the composer but never re-emitted by the stringifier — only a document-level leading comment round-trips. This is the same limitation v3 shipped with; the redesign did not regress it, and closing it is future work if a consumer needs full comment round-tripping.
