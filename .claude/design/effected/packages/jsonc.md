---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../formatter-convention.md
  - ../package-inventory.md
  - yaml.md
  - toml.md
  - markdown.md
  - config-file.md
---

# @effected/jsonc design

## Overview

`@effected/jsonc` is zero-dependency JSONC parsing, editing and formatting as Effect schemas. All inputs are strings; all outputs are values, edits, streams or domain errors. Four things define its shape: a vendored zero-dependency scanner/parser core, an **edits-not-mutations** model (byte-minimal edits that preserve comments and whitespace — the whole value proposition over a `JSON.parse`/`stringify` round-trip), a parent-pointer-free AST and a single aggregate parse error.

It is the reference template for [`@effected/yaml`](yaml.md); the two share a structural vocabulary bound by the [parity convention](#jsoncyaml-parity-convention).

## Tier and dependencies

Pure tier — no IO anywhere. `effect` is the only peer. No `@effect/platform*` imports, no `node:` imports and no outbound `@effected` edges; [`config-file`](config-file.md) and `workspaces` depend on this package, never the reverse. `"sideEffects": false`.

## Module layout

Module-per-concept per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); `src/index.ts` is the only re-exporting module and carries the full export list.

- `Jsonc.ts` — the facade: a namespace object of statics over the parser and schema layers, not a schema class. Owns the parse and stringify option/error vocabulary.
- `JsoncNode.ts` — the recursive AST node, with the `JsoncPath` / `JsoncSegment` aliases.
- `JsoncEdit.ts` — the edit class plus `applyAll`, and the shared `JsoncRange` / `JsoncFormattingOptions` vocabulary.
- `JsoncFormatter.ts`, `JsoncModifier.ts`, `JsoncVisitor.ts` — formatting, path modification and the SAX stream.
- `JsoncFingerprint.ts` — RFC 8785 canonical JSON and SHA-256 content fingerprints; see [Fingerprinting](#fingerprinting-canonical-json-and-content-hashes).
- `internal/` — the private engine: scanner, recursive-descent parser, scanner-based navigator, the shared `skipBalancedValue` and `limits.ts`.

`JsoncFormatter` is its own module rather than folded into the facade: a standalone formatter keeps the facade small and makes the jsonc and yaml surfaces structurally symmetric.

The engine in `internal/` is **vendored** — ported with attribution to Microsoft's `jsonc-parser` design (MIT). That is house policy for pure-tier format packages: vendor and attribute, never take a runtime dependency.

## Engine/facade split as a cycle firewall

`noImportCycles` is error-level, so the split is structural, not stylistic. `internal/` returns raw records — `{ code, offset, length }` parse errors, `_tag`-discriminated navigate results — and the facade materializes the `Schema.Class` types and tagged errors from them, deriving each detail's `line`/`character` from its `offset` against the source text. Offsets are the engine's single positional currency; the scanner tracks no line or column of its own.

An internal module importing a facade module fails the lint. The one permitted edge is `internal/parser.ts` → `JsoncNode.ts`, which is exactly why the depth cap lives in the zero-dependency leaf `internal/limits.ts`: every recursive surface imports one constant without closing a cycle.

## Effect-wrapping policy

The package-wide rule, and the template `@effected/yaml` follows: **pure synchronous methods where nothing can fail; `Effect` only where the error channel is real.** This makes fallibility legible at the call site — an `Effect` return type *means* "this can produce a `JsoncParseError`" — and keeps the flagship pure operations ergonomic without forcing callers into `runSync`.

- **Pure synchronous:** node value extraction, edit application, formatting (computing edits never fails), comment stripping and semantic equality.
- **`Effect`:** parsing, stringifying, modification and the schema decode path.
- **`Result`:** every fallible operation also has a synchronous `Result` twin, and the `Effect` form is *defined in terms of it* via `Effect.fromResult` behind the named span. The two cannot diverge, and callers outside an Effect runtime pay nothing. Kit convention — [formatter-convention.md](../formatter-convention.md).
- **`Stream`** for the visitor: demand-driven and `Stream.take`-friendly, with malformed input surfacing as error events in the union rather than a failure channel.

`equals` and `equalsValue` are pure total booleans with a hardened contract: input with **any** parse errors compares unequal rather than comparing the recovery parser's best-effort output. Malformed input is never equal to anything, including itself.

## Public API shapes

Class-based DX throughout: statics and instance methods on the schema classes, single-optional-parameter statics rather than overload-object signatures. The load-bearing shapes:

**`JsoncNode`** is a `Schema.Class` recursive AST node via `Schema.suspend`, with **no parent pointers** — circular references would break structural equality, serialization and Schema encode/decode. Absence is always `Option`, never a `NotFound` error. Its **tight token-end offset discipline** — node spans never swallow trailing whitespace or comments — is a load-bearing invariant with its own regression tests.

**`JsoncEdit.applyAll`** applies edits in reverse-offset order and **rejects overlapping edits as a defect**. Overlapping splices are a caller wiring error on a hand-constructed array, not recoverable input, so the defect channel is right — a programmer-error guard, not input hardening. All four format siblings share this posture.

**`JsoncModifier.modify`** treats `value === undefined` as delete (comma handling included) and appends on insert. Navigation goes through `internal/navigate.ts`, a scanner-based navigator resolving segments through structural tokens rather than a raw substring match — a correctness property, since a naive backwards string search breaks on keys containing quotes.

**Option fields are plain `Schema.optionalKey`** with defaults applied at the implementation level (`options?.field ?? default`), which keeps the `@public` base annotations tractable. `allowTrailingComma` defaults to `true`, matching the tsconfig / VS Code settings dialect the format exists to serve.

`JsoncModifyOptions.formattingOptions` accepts `JsoncFormattingOptionsLike` — the class instance *or* a structurally-matching plain literal — because only the option fields are read and nothing decodes, so requiring construction would buy validation the modifier never performs. This follows the `YamlRangeLike` posture in [yaml](yaml.md) rather than inventing a second convention. **`JsoncFormattingOptions` remains the canonical stored form**: the `Like` type is an input accommodation at the boundary, not a second representation.

## Value stringify is plain JSON

`Jsonc.stringify` writes exactly what `JSON.stringify(value, null, 2)` writes. Comments live only in the document and edit layers, so they never survive a value round-trip.

Its options reuse the `JsoncFormattingOptions` vocabulary (`tabSize`, `insertSpaces`) rather than JSON's `space`, so one indent vocabulary covers the formatter and the emitter.

The typed failure set is closed by the underlying primitive rather than invented: circular references and `bigint` are the two exceptions `JSON.stringify` throws, and a top-level unrepresentable is the case where it returns `undefined` instead of a string. **Nested** unrepresentables — functions, `undefined`, symbols — follow `JSON.stringify`'s documented semantics exactly: dropped from objects, `null` in arrays. Do not "harden" that into a typed error; it is JSON's contract, matched on purpose.

## Schema transformation strategy

The transformation layer mirrors semver's `FromString` + factory-statics arrangement, and is the reason an Effect-native JSONC library exists at all:

- `Jsonc.JsoncFromString` — the pre-bound zero-config `Schema<unknown, string>` on default options.
- `Jsonc.fromString(options?)` — the same, bound to supplied options.
- `Jsonc.schema(Target, options?)` — composes with a target schema to yield a `Schema<A, string>` pipeline. Its generics thread the target's **decode and encode requirements** through to the result; a signature that dropped them would silently vanish a target's service requirements into `R = never`.
- `Jsonc.bind(Target)` — `{ schema, decode, encode }`, both directions derived once from the composed schema. Deliberately thin sugar: it introduces **no new error taxonomy**, both directions failing `Schema.SchemaError` exactly as calling the `Schema` helpers by hand would. The value is that a consumer binds once and never touches generic `Schema` machinery again.

Decode is driven by the internal parser in value mode; encode goes through the stringify path, so circular-reference and `bigint` failures are typed on the encode channel rather than escaping as defects.

The **domain `JsoncParseError` is constructed directly by the `parse`/`parseTree` path**, bypassing `Schema` entirely — that is the documented contract of those methods, and it is why `SchemaError` never escapes them. The raw schema decode path is the exception: it fails with a `SchemaError` whose issue message is the aggregate parse message, and consumers wanting the domain error normalize at the boundary with `Effect.catchTag("SchemaError", ...)`, the same shape semver ships.

**Memoization by reference.** `fromString` and `schema` are schema-*producing* functions, so each call returns a fresh instance, and v4 derivation caches key by reference — structurally-equal options do not share. Bind the produced schema to a `const` on a hot path. `JsoncFromString` is the pre-bound singleton precisely so the common default case needs no such discipline.

## Error set

A restrained aggregate design, correct where a per-error-class explosion would be wrong. Parsing is **error-recovering**: it collects every parse-error detail and fails once with an aggregate carrying the whole batch plus the input, rather than failing at the first bad byte. Each detail is a `Schema.Class` (not an error) carrying a code and a position.

Errors are `Schema.TaggedError` with `message` derived via getter from structured fields, never a preformatted string, and never a `reason: string`. See `src/Jsonc.ts` and `src/JsoncModifier.ts` for the current set.

## Input hardening

Per the [input-hardening standard](../effect-standards.md#input-hardening-standards), deeply-nested hostile input must fail through the typed channel — never as a `Cause.Die`, never as a stack overflow.

Collection-nesting depth is capped by a shared constant in `src/internal/limits.ts`, a zero-dependency leaf so every recursive surface imports the same cap without closing a cycle. The cap mirrors yaml's composer cap for cross-package parity.

jsonc's recursion is spread across several independent surfaces — the parser's value and tree modes, the node walkers, the structural-equality walk, the visitor and the modifier's navigation — and **each is guarded separately**; there is no single choke point. Over-deep containers are consumed iteratively by bracket counting so recovery still makes progress. That skip algorithm plus its malformed-closer guard has **one implementation**, `skipBalancedValue` in `src/internal/skip.ts`, parameterized over a token cursor so the parser, navigator and visitor each keep their own advance discipline over a shared algorithm.

**Tree construction is validation-free.** A naive `parseTree` is exponential in nesting depth, because `Schema.Class` construction re-validates the recursive `children` field once per level. The parser builds nodes through an internal unsafe path in `JsoncNode.ts` (never re-exported) that assigns props onto the prototype directly; validity is guaranteed by construction, since every field comes off a scanner token. Public `JsoncNode.make` and `new` stay fully validating. The one contract the unsafe path carries: absent optional fields must be omitted, never passed as explicit `undefined`.

## Equal and Hash semantics

The AST nodes use plain `Schema.Class` structural equality with no custom `[Equal.symbol]`, and that equality is load-bearing for the visitor and token tests. `Jsonc.equals`/`equalsValue` implement the *semantic* equality — comment- and format-ignoring, key-order-independent for objects, order-sensitive for arrays — which is a different relation, so they stay explicit statics rather than overriding structural equality.

If a node ever customizes equality it MUST override `[Hash.symbol]` too, since `Equal.equals` fast-paths on hash mismatch.

## jsonc/yaml parity convention

There is deliberately **no shared-package extraction**: a possible `@effected/text-edit` micro-kernel over Edit/Range/Path/diff is deferred until the shapes prove identical in use. In its place, a binding convention: `JsoncEdit`, `JsoncRange`, `JsoncPath`, `JsoncSegment` and the parse-error-detail shape are **structurally identical** to their `Yaml*` counterparts — same field names, types and optionality, with the same `applyAll`/`equals`/`schema` semantics. The point is codec-generic consumer code: one function over "a document codec's Edit/Range/Path" works against both packages.

Two exceptions are recorded rather than fixed. `YamlFormattingOptions` derives its shared fields from `YamlStringifyOptions` at runtime by spreading `.fields`, which is not structurally identical even though the names and semantics line up ([yaml's options derivation](yaml.md#options-derivation)). And `JsoncModificationError` is not bound by the convention at all — its fields differ from yaml's because the underlying failures differ. The convention binds Edit/Range/Path, not the errors.

## Fingerprinting: canonical JSON and content hashes

`JsoncFingerprint.ts` adds RFC 8785 (JSON Canonicalization Scheme, JCS) serialization plus SHA-256 content hashing over it, for callers that need a stable digest of a JSON value — cache keys, change detection, attestation subjects — independent of key order or source formatting.

The pure core is a single recursive JCS emitter: compact output, object keys sorted by UTF-16 code unit (`<` on JS strings, per RFC 8785 §3.2.3), ECMAScript number serialization and `JSON.stringify` string escaping. It follows the package's usual `Result` primitive / spanned `Effect` twin arrangement — `canonicalizeResult` is the sync primitive, `canonicalize` is `Effect.fromResult` behind a named span.

**Canonicalization is deliberately stricter than `Jsonc.stringify`.** `Jsonc.stringify` follows `JSON.stringify`'s documented drop/null semantics for nested unrepresentables; a fingerprint must never silently alter the document it claims to summarize, so every non-JSON value fails typed instead, carrying a JSON-pointer `path` to the offending value. `JsoncCanonicalizeError`'s closed code set: `UnrepresentableValue` (`undefined`, function, symbol, anywhere), `BigIntValue`, `NonFiniteNumber` (`NaN`/`±Infinity`, which RFC 8785 forbids and `JSON.stringify` would silently null), `NonPlainObject` (anything but a plain object or array — `toJSON` methods are deliberately ignored; encode domain values to plain JSON, e.g. via `Schema`, first) and `NestingDepthExceeded` (the shared `MAX_NESTING_DEPTH` cap from `internal/limits.ts`, which also intercepts cyclic values before they can recurse forever — the one hardening surface this module needs).

**Hashing requires core's `Crypto.Crypto` service in `R`, and that does not lift the tier.** `hash`/`hashText` need a real digest backend, which this pure-tier package does not own — the sanctioned pattern is a service required in `R` with the backend supplied by the consumer at the edge (`@effect/platform-node`'s `NodeCrypto.layer`, or any `Crypto` layer, e.g. one built with `Crypto.make` over WebCrypto). This is **not** a tier violation: [R1](../effect-standards.md#dependency-policy) governs runtime *dependencies* and IO ownership, not service *requirements* threaded through `R` — jsonc still has zero runtime dependencies and the module owns no backend. A future reader auditing "why does a pure package have `R ≠ never`" should read this paragraph before flagging it.

The output format is a cross-package guarantee: exactly 64 lowercase hex characters, no `sha256:` or other algorithm prefix — the same bare-hex vocabulary `@effected/sbom`'s `Sha256Digest` schema decodes, so a fingerprint flows into an attestation subject downstream **without this package taking a dependency edge on `sbom`**. `hashText` additionally exposes `normalizeEol` (also available standalone as the pure `JsoncFingerprint.normalizeEol`) for file content that must fingerprint identically across checkout line-ending settings.

Equal JSON values canonicalize (and therefore hash) identically regardless of object key order — the whole point of JCS over a plain `JSON.stringify` digest.

## Observability

`Effect.fn("name")` at public *fallible* boundaries only — parse, tree parse, stringify and modify. Pure synchronous operations are not instrumented: no `Effect`, no span. The `Result` twins carry no span, since they are not Effects; their `Effect` counterparts keep theirs while delegating, so Effect consumers lose nothing.

`JsoncVisitor.visit` is **not** span-wrapped: stream construction is lazy and pure, with no clean `Effect.fn` boundary to attach a span to without forcing the stream into an effect it does not need.

The library stays telemetry-agnostic — applications compose `@effect/opentelemetry` at the edge.

## API Extractor bases

Per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), every Effect class factory is written **inline** with no exported `*_base` const; the synthesized `_base` heritage symbols are suppressed narrowly in `savvy.build.ts` and land in the `issues.json` `suppressed` bucket, keeping it zero-warning. Never widen the suppression. Genuinely reusable public schemas stay `@public` on their own merit.

## Testing

`@effect/vitest` with `it.effect` as the default mode; `__test__/` splits per concept. Construct instances via `X.make(...)`, never `new`.

The suite is organized around behavior contracts rather than methods: token-end offset discipline, edit byte-minimality, the two equality semantics, delete and insert contracts, offset-preserving comment stripping, the schema decode/encode pipeline and quote-containing-key navigation. Property tests via `it.effect.prop` assert format idempotence and that parsing comment-stripped text agrees with `JSON.parse`. Hardening regressions pin deep and wide documents, plus structural equality between parser-built and `make`-built nodes.
