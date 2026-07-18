---
status: current
module: effected
category: architecture
created: 2026-07-07
updated: 2026-07-17
last-synced: 2026-07-17
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - semver.md
  - package-json.md
  - npm.md
  - yaml.md
---

# @effected/jsonc design

## Overview

`@effected/jsonc` is zero-dependency JSONC parsing, editing and formatting as Effect schemas — a **pure-tier** package. All inputs are strings; all outputs are values, edits, streams or domain errors. Its load-bearing shape: a zero-dependency scanner/parser core, an edits-not-mutations model (byte-minimal edits that preserve comments and whitespace, the core value proposition over `JSON.parse`/`stringify` round-trips), a parent-pointer-free AST, a single aggregate parse error and string→domain schema factories.

It is the reference template for [`@effected/yaml`](yaml.md): the two packages share a structural vocabulary bound by the [parity convention](#jsoncyaml-parity-convention).

## Tier and dependencies

Pure tier — no IO anywhere. `peerDependencies`: `effect` only (`catalog:effect`). No `@effect/platform*` imports, no `node:` imports, no cross-`@effected` edges outbound; `@effected/config-file` and `@effected/workspaces` depend on this package, not the reverse. `"sideEffects": false`.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); every non-entrypoint module imports explicitly from defining modules — no barrels. See `src/` for the full set:

- `Jsonc.ts` — the facade: statics `parse`, `parseResult`, `parseTree`, `stripComments`, `equals`, `equalsValue`, the schema factories `schema(Target, options?)` / `fromString(options?)` and the `JsoncFromString` default-options schema. Owns `JsoncParseOptions`, `JsoncParseError`, `JsoncParseErrorDetail` and the `JsoncParseErrorCode` literal set.
- `JsoncNode.ts` — the recursive AST node (`Schema.Class` + `Schema.suspend`, no parent pointers). Owns `JsoncNodeType` and the `JsoncPath` / `JsoncSegment` type aliases.
- `JsoncEdit.ts` — the edit `Schema.Class` plus `applyAll(text, edits)`. Owns the shared edit vocabulary `JsoncRange` and `JsoncFormattingOptions`.
- `JsoncFormatter.ts` — `format` and the `formatToString` convenience.
- `JsoncModifier.ts` — `modify` and `JsoncModificationError`.
- `JsoncVisitor.ts` — the event union and `visit(text, options?) -> Stream`.
- `internal/` — the private scanner, the recursive-descent parser (owning the single scan-error→parse-code mapping), the scanner-based navigator, the shared `skipBalancedValue` and `limits.ts`.

`JsoncFormatter` is its own module rather than folded into the facade: a standalone formatter keeps the facade small and makes the jsonc/yaml surfaces structurally symmetric (`YamlFormatter` has the identical shape).

## Effect-wrapping policy

The package-wide rule, and the template for `@effected/yaml`: **pure synchronous methods where nothing can fail; `Effect` only where the error channel is real.** This makes fallible operations legible at the call site — an `Effect` return type *means* "this can produce a `JsoncParseError`" — and keeps the flagship pure operations ergonomic without forcing callers into `runSync`.

- **Pure synchronous** (no `Effect`): node value extraction (`JsoncNode.toValue`), edit application (`JsoncEdit.applyAll`, `JsoncFormatter.formatToString`), formatting (`JsoncFormatter.format` — computing edits never fails), comment stripping (`Jsonc.stripComments`) and semantic equality (`Jsonc.equals` / `equalsValue`).
- **`Effect`** (real typed `E`): `Jsonc.parse`, `Jsonc.parseTree`, `JsoncModifier.modify` and the schema decode path.
- **`Result`** (sync escape hatch): `Jsonc.parseResult` returns a v4 `Result<unknown, JsoncParseError>` for callers outside the Effect runtime — jsonc's counterpart to yaml's [`parseSync` posture](yaml.md#effect-wrapping-policy). `Jsonc.parse` is *defined in terms of it* (`Effect.fromResult` behind the named span), so the two variants cannot diverge; the `@remarks` steer Effect consumers to `parse` for the span.
- **`Stream`** for the visitor: `JsoncVisitor.visit` returns `Stream<JsoncVisitorEvent>`, demand-driven and `Stream.take`-friendly; malformed input surfaces as error events in the union.

`equals` / `equalsValue` are pure total booleans with a hardened contract: inputs with **any** parse errors compare unequal (return `false`) rather than comparing the recovery parser's best-effort output, so malformed input is never equal to anything. They run the recovery parser but short-circuit to `false` whenever either side produced parse errors, comparing recovered values only when both sides parsed cleanly.

## Public API

Class-based DX throughout: statics and instance methods on the schema classes, single-optional-parameter statics rather than overload-object signatures. See `src/` for exact signatures; the shapes below are the load-bearing ones.

### Jsonc (facade)

A namespace object of statics over the parser and schema layers, not a schema class.

- `parse(text, options?)` → `Effect<unknown, JsoncParseError>` — error-recovery parsing that collects all parse-error details and fails once with the aggregate. Returns `unknown`, never `any`.
- `parseResult(text, options?)` → `Result<unknown, JsoncParseError>` — the synchronous `Result` variant with identical error-recovery semantics; `parse` delegates to it (see [Effect-wrapping policy](#effect-wrapping-policy)).
- `parseTree(text, options?)` → `Effect<Option<JsoncNode>, JsoncParseError>` — `Option.none()` for empty input, the aggregate error for malformed input.
- `stripComments(text, replaceCh?)` → `string` — offset-preserving (replaces comment bytes with `replaceCh`, default space).
- `equals` / `equalsValue` → `boolean` — key-order-independent for objects, order-sensitive for arrays, comments/formatting ignored.
- The schema factories and `JsoncFromString` — see [Schema transformation strategy](#schema-transformation-strategy).

`JsoncParseOptions` models its fields as plain `Schema.optionalKey` and applies defaults at the implementation level (`options?.field ?? default`), which keeps the `@public` base annotations tractable. `allowTrailingComma` defaults to `true` — the deliberate tsconfig / VS-Code-settings default. `JsoncFormattingOptions` follows the same bare-`optionalKey` pattern.

### JsoncNode

A `Schema.Class` recursive AST node via `Schema.suspend`, with **no parent pointers** (circular refs would break structural equality, serialization and Schema encode/decode). Construct via `JsoncNode.make(...)`, never `new`. Instance methods `find(path)`, `findAtOffset(offset)`, `pathAt(offset)`, `toValue()`; absence is always `Option`, never a `NotFound` error.

The **tight token-end offset discipline** — node spans never swallow trailing whitespace or comments — is a load-bearing invariant with its own regression tests. The recursive class is written **inline** with the synthesized `_base` symbol suppressed in `savvy.build.ts`; only the `Schema.suspend` callback's own return-type annotation survives, since a recursive `suspend` still needs it.

### JsoncEdit and JsoncFormatter

`JsoncEdit` holds `offset`, `length`, `content`; `applyAll(text, edits)` applies in reverse-offset order (byte-minimal, comment/whitespace preserving). It owns `JsoncRange` and `JsoncFormattingOptions`. `JsoncFormatter.format` computes edits (pure, never fails); `formatToString` is `applyAll ∘ format`.

### JsoncModifier

`modify(text, path, value, options?)` → `Effect<ReadonlyArray<JsoncEdit>, JsoncModificationError>`. `value === undefined` means delete (including comma handling); insertion appends after the last property/element. Navigation goes through `internal/navigate.ts`, a tested scanner-based navigator that resolves segments through structural tokens rather than a raw substring match — a correctness property, since a naive backwards string search breaks on keys containing quotes.

`JsoncModifyOptions.formattingOptions` is typed `JsoncFormattingOptionsLike` — a `JsoncFormattingOptions` **instance or a structurally-matching plain literal**, so a caller writes `{ insertSpaces: false, tabSize: 2 }` without constructing the class. Only the option fields are read, and nothing decodes, so requiring construction bought validation the modifier never performs. This follows the established `YamlRangeLike` posture in [@effected/yaml](yaml.md) rather than inventing a second convention, and the widening is source-compatible — every existing instance call site still typechecks. **`JsoncFormattingOptions` remains the canonical stored form**: the `Like` type is an *input* accommodation at the boundary, not a second representation, so anything held or passed onward is still the class.

### JsoncVisitor

`visit(text, options?)` → `Stream<JsoncVisitorEvent>`, wrapping the generator with `Stream.fromIterable`. The event union is a `Data.taggedEnum`, making events serializable; begin/property/literal events carry `path` context and malformed-input error events are part of the union.

## Schema transformation strategy

The `JsoncFromString` default-options singleton and the factories are both flagship DX, mirroring semver's `SemVer.FromString` + factory-statics arrangement:

- `Jsonc.JsoncFromString` — a `Schema<unknown, string>` transformation using the default `JsoncParseOptions`; the zero-config entry point.
- `Jsonc.fromString(options?)` — a factory returning a `Schema<unknown, string>` bound to the supplied options; `JsoncFromString` is `Jsonc.fromString()` with defaults.
- `Jsonc.schema(Target, options?)` — composes `fromString(options)` with a target `Schema`, yielding the `Schema<A, string>` pipeline that is the reason an Effect-native JSONC library exists.

Decode is driven by the internal parser (value mode); encode is `JSON`-style stringification. The **domain `JsoncParseError` is constructed directly by the `parse` / `parseTree` path**, which bypasses `Schema` entirely — so `SchemaError` never escapes as the documented contract of those methods. The raw schema decode path fails with a `SchemaError` carrying a `SchemaIssue.InvalidValue` whose message is the aggregate parse message; consumers wanting the domain error from a schema pipeline normalize at the boundary with `Effect.catchTag("SchemaError", ...)`, the same shape semver ships.

**Memoization by reference.** `fromString(options)` and `schema(Target, options)` are schema-*producing* functions, so each call returns a fresh instance; v4 schema derivation caches key by reference and are not shared across calls with structurally-equal options. Consumers on a hot path should bind the produced schema to a `const` once. `JsoncFromString` is the pre-bound singleton precisely so the common default case needs no such discipline.

## Error set

A restrained aggregate design (the best error shape in this vocabulary, and correct where a per-error-class explosion would be wrong):

| Error | Raised by | Payload |
| --- | --- | --- |
| `JsoncParseError` | `parse` / `parseTree`; schema decode | `errors: ReadonlyArray<JsoncParseErrorDetail>`, `input: string` |
| `JsoncModificationError` | `JsoncModifier.modify` | `path`, `expected: "object" \| "array"`, `depth`, optional `offset` (reserved, currently unpopulated) |

`JsoncParseErrorDetail` is a `Schema.Class` (not an error) carrying `code: JsoncParseErrorCode`, `offset`, `length`, `line`, `character` — one detail per recovered parse error, so a single `JsoncParseError` reports the whole batch. Both errors are `Schema.TaggedErrorClass` with `message` derived via getter, never preformatted strings.

**Import-cycle firewall.** `JsoncParseError` is owned by the facade, but the internal parser must not import it (`Jsonc.ts → internal/parser.ts → Jsonc.ts` would be a cycle, and `noImportCycles` is error-level). `internal/parser.ts` owns the parse-error-code const and returns raw `{ code, offset, length }` records; `Jsonc.ts` builds the public `JsoncParseErrorCode` schema from that const, computes each detail's `line`/`character` from `offset` against the source text, and constructs the aggregate. Because offsets are the parser's single positional currency, the scanner tracks no `line`/`character` of its own. `internal/navigate.ts` is symmetric: it returns plain navigation results and `JsoncModifier.ts` constructs `JsoncModificationError`.

## Input hardening

Per the [input-hardening standard](../effect-standards.md#input-hardening-standards), deeply-nested hostile input must fail through the typed channel rather than overflowing the stack. Collection-nesting depth is capped at a shared `MAX_NESTING_DEPTH` in `src/internal/limits.ts` — a zero-dependency leaf so every recursive surface imports the same cap without an import cycle. The cap mirrors `@effected/yaml`'s composer cap for cross-package parity.

jsonc's recursion is spread across five independent surfaces, each guarded separately: the recursive-descent parser's value and tree modes (a `NestingDepthExceeded` code, with over-deep containers consumed iteratively via bracket-counting so recovery still makes progress); `JsoncNode.toValue`/`findAtOffset`/`buildPath`; the `equals`/`equalsValue` structural walk (over-deep comparison returns `false`); the visitor SAX walk (in-band error event); and the modifier's navigation. The bracket-counting skip plus the malformed-closer guard have **one implementation**, `skipBalancedValue` in `src/internal/skip.ts`, parameterized over a token cursor so the parser, navigator and visitor each keep their own advance discipline over a shared algorithm.

**Tree construction is validation-free.** A naive `parseTree` is exponential in nesting depth, because `Schema.Class` construction re-parses the recursive `children` field. The parser builds nodes through an internal `makeNodeUnsafe` path in `JsoncNode.ts` (never re-exported) that assigns props onto the class prototype directly; the parser guarantees validity by construction, since every field comes off a scanner token. Public `JsoncNode.make` and `new` stay fully validating. The one contract the unsafe path carries: absent optional fields must be omitted, never passed as explicit `undefined`.

## Equal and Hash semantics

`Schema.Class` structural equality (`Equal.equals` on nodes) is load-bearing for the visitor/token tests. `Jsonc.equals`/`equalsValue` implement the *semantic* (comment/format-ignoring, key-order-independent) equality distinct from structural `Equal.equals`, so they stay explicit statics. The AST nodes use structural equality with no custom `[Equal.symbol]`; if a node ever customizes equality it MUST override `[Hash.symbol]` too (`Equal.equals` fast-paths on hash mismatch), with a regression test pinning hash agreement.

## jsonc/yaml parity convention

There is **no shared-package extraction**: a possible later `@effected/text-edit` micro-kernel covering Edit/Range/Path/diff is deferred until the shapes prove identical in use ([package-inventory.md](../package-inventory.md)). In its place, a binding convention: `JsoncEdit`, `JsoncRange`, `JsoncPath`, `JsoncSegment` and the parse-error-detail-with-position shape (`JsoncParseErrorDetail`'s fields) are **structurally identical** to their `Yaml*` counterparts — same field names, types, optionality and `applyAll`/`equals`/`schema` semantics. The point is codec-generic consumer code: one function over "a document codec's Edit/Range/Path" works against both packages.

`YamlFormattingOptions` is the one exception — it derives its shared fields from `YamlStringifyOptions` at runtime by spreading `.fields`, which is not structurally identical even though field names and semantics line up (see [yaml.md's options derivation](yaml.md#options-derivation)). `JsoncModificationError` is deliberately not bound by the convention: its `expected`/`depth` fields differ from yaml's because the underlying failures differ; the convention binds Edit/Range/Path, not this error.

## Observability

Per the observability standard, `Effect.fn("name")` at public *fallible* boundaries only: `parse`, `parseTree` and `modify`. Pure synchronous operations are not instrumented — no `Effect`, no span. `parseResult` carries no span (it is not an Effect); `parse` keeps its `Jsonc.parse` span while delegating to it, so Effect consumers lose nothing by the delegation. `JsoncVisitor.visit` is **not** span-wrapped: stream construction is lazy and pure, with no clean `Effect.fn` boundary to attach a span to without forcing the stream into an effect it does not need. The library stays telemetry-agnostic — applications compose `@effect/opentelemetry` at the edge.

## API Extractor bases

Per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), every Effect class factory is written **inline** with no exported `*_base` const; the synthesized `_base` heritage symbols are suppressed narrowly in `savvy.build.ts` (`ae-forgotten-export` / `_base` pattern) and land in the `issues.json` `suppressed` bucket, keeping it zero-warning. Genuinely-reusable public schemas (`JsoncParseErrorCode`, field schemas that are real API) remain `@public` on their own merit.

## Testing

`@effect/vitest` with `it.effect` as the default mode; tests in `__test__/` split per concept. Construct instances via `X.make(...)`, never `new`. The suite covers every behavior contract: token-end offset discipline, edits-not-mutations byte-minimality, `equals`/`equalsValue` equality semantics, `modify` delete/insert contracts, `stripComments` offset preservation, the `schema` decode/encode pipeline and quote-containing-key navigation through `internal/navigate.ts`. Property tests via `it.effect.prop` with `Schema.toArbitrary` assert `applyAll ∘ format` idempotence and `parse ∘ stripComments` agreement with `JSON.parse`. Hardening regressions pin deep and wide documents plus structural equality between parser-built and `make`-built nodes.
