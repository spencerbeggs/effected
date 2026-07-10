# @effected/toml

Zero-dependency TOML 1.0.0 parse/edit/format schemas: parse into plain values or a byte-exact linear CST, compute comment-preserving edits, format, modify by path, visit as a `Stream`.

**Tier: pure.** Peer-depends on `effect` only. Zero runtime deps, no IO. Eighth migration; merged. **The first format package in the repo with no vendored code** — jsonc, yaml and glob all port an upstream engine with attribution; toml's engine is original work, built from the TOML 1.0.0 spec directly rather than translated from a reference implementation.

**For the full design:** → `@../../.claude/design/effected/packages/toml.md`

Load when changing the public API, the CST shape, the hardening story, or the jsonc/yaml/toml edit-vocabulary parity convention.

## Architecture: linear CST + semantic pass

`internal/scanner.ts` and `internal/parser.ts` produce a flat `ReadonlyArray<TomlExpression>` — one entry per top-level construct (`TomlKeyValue`, `TomlTableHeader`, `TomlArrayTableHeader`, `TomlTrivia`) — in document order. This is the **linear CST**: no tree, just a list whose expression spans tile the source exactly. That tiling is the round-trip proof — `TomlDocument.stringify()` reconstructs the source by concatenating each expression's `[offset, offset + length)` slice, and the result equals the original byte-for-byte across the full toml-test corpus. There is no separate re-serialization path to drift from the source.

`internal/semantic.ts`'s `analyze` walks that flat list a second time, resolving TOML's table/key model — implicit vs. explicit tables, array-of-tables elements, dotted-key groups, duplicate-key and table-redefinition conflicts — against an iterative navigation structure, not a recursive tree walk. `buildValue` (also in `semantic.ts`) rides the same pass to materialize the plain-JS value. `TomlFormat.modify`'s semantic index (`buildSemanticIndex`) is a third, purpose-built walk over the same expression list, because modification needs a resolution tree with insertion points, which `analyze`'s callback-only pass does not carry.

## Cycle firewall

`noImportCycles` is error-level, held by one rule: `src/internal/` throws **raw carriers** — `RawTomlError` (`{ code, message, offset, length }`, `internal/diagnostics.ts`) and `GuardExceeded` (`internal/limits.ts`) — and never imports a public module. Public modules (`Toml.ts`, `TomlDocument.ts`, `TomlFormat.ts`, `TomlVisitor.ts`) catch those throws and materialize `TomlDiagnostic` (deriving `line`/`character` from `offset`) plus the tagged `TomlParseError` / `TomlStringifyError` / `TomlModificationError`.

The one sanctioned exception: the engine may import `TomlNode.ts`'s node classes and `TomlDateTime.ts`'s four value classes — both are leaves (`TomlDateTime.ts` imports only `effect`; `TomlNode.ts` imports only `effect` and `TomlDateTime.ts`), so importing them from `internal/` cannot close a cycle back into the facade. Nothing else under `src/*.ts` is a legal engine import.

## Hardening inventory

Malformed or hostile input fails through the typed `E` channel — never a `Cause.Die` defect, never `RangeError: Maximum call stack size exceeded`, never a hang. `MAX_NESTING_DEPTH = 256` (`internal/limits.ts`) is enforced independently on both sides of the codec, because arrays and inline tables are the only genuinely recursive value shapes:

1. **Parse side** — `internal/parser.ts`'s `parseArray`/`parseInlineTable` guard array/inline-table descent via an explicit `depth` parameter against `MAX_NESTING_DEPTH`; a bomb trips `GuardExceeded` at the opening bracket, materialized by `Toml.parse`/`TomlDocument.parse`/`TomlVisitor.visit` into a `NestingDepthExceeded` diagnostic. (`semantic.ts`'s `buildValue` needs no guard of its own — it rides the CST the parser already depth-capped.)
2. **Stringify side** — `internal/stringifyValue.ts` guards the mirror-image descent when encoding a value back to text; a bomb trips the same `GuardExceeded`, materialized by `Toml.stringify`.
3. **`TomlFormat.modify`'s path argument** is capped at `MAX_NESTING_DEPTH` explicitly (not via `GuardExceeded` — a straight length check before resolution starts), so an attacker-controlled path array cannot force unbounded navigation depth.

**Header and dotted-key nesting is deliberately not guarded the same way, because it is not recursion.** `[a.b.c...]` table headers and `a.b.c... = 1` dotted keys are parsed and navigated **iteratively** — `internal/parser.ts`'s key-path scan is a loop, and `analyze`'s `navigateHeaderPrefix`/dotted-key walk in `TomlFormat.ts` is a loop over a `Map`. A header with 5,000 segments parses and resolves fine; there is no stack to blow. Guarding it would be defending against a cost that does not exist. Know this before "fixing" header depth to match the 256 value cap — that would be over-guarding a non-recursive surface.

Defect passthrough is proven, not assumed: every `catch` block in the facade (`Toml.ts`, `TomlDocument.ts`, `TomlFormat.ts`, `TomlVisitor.ts`) checks `isRawTomlError` and `isGuardExceeded` in that order and **rethrows anything else** — the engine never silently swallows a genuine programmer-error defect (e.g. a `TypeError` from `assertCap`) into a typed error channel it doesn't belong in.

## Value model

- **Four date-time classes** (`TomlDateTime.ts`): `TomlLocalDate`, `TomlLocalTime`, `TomlLocalDateTime`, `TomlOffsetDateTime`. None subclasses JS `Date` — `effect`'s `DateTime` module has no local-only (no-offset, no-timezone) variant, so all four are `Schema.Class` value objects with real Gregorian-calendar validation (`isRealCalendarDate`, leap-year aware), a canonical `toString`, and structural equality for free from `Schema.Class`.
- **Integers split number/bigint at `±(2^53 − 1)`** (`Number.MAX_SAFE_INTEGER`/`MIN_SAFE_INTEGER`): a TOML integer within that range decodes to a JS `number`; beyond it, to a `bigint`. Both sides are bounds-checked against TOML's 64-bit integer range (`IntegerOutOfRange` on overflow, both parse and stringify).
- **The `1.0` → `1` emitter divergence**: an integral float (`1.0`, `2.0`) that fits exactly in a JS `number` stringifies as `1`, indistinguishable from a TOML integer, because JS has no way to tag a `number` as "float-typed" once it holds an integral value. Every JS TOML emitter shares this limitation — it is not a bug specific to this engine, and there is no representable fix without a wrapper type this package deliberately does not add. Integral floats past `int64` range (i.e. large enough that a `number` cannot round-trip through integer semantics) emit as TOML floats, since at that magnitude the ambiguity does not arise.

## Testing discipline: corpus + differential oracle

Two independent checks, neither a substitute for the other:

- **The vendored toml-test 1.0.0 corpus** (`__test__/fixtures/toml-test/`, `files-toml-1.0.0` subset: 205 valid + 474 invalid cases) runs in `__test__/e2e/toml-test.e2e.test.ts` to **100% pass, no skip list**. Every valid case decodes to its expected typed value; every invalid case fails through `TomlParseError`. The corpus tree carries its own `.gitattributes` (`* -text`) scoping off the repo-root `*.toml text eol=lf` rule, because several fixtures deliberately embed bare CR / CRLF bytes to exercise line-ending handling and must stay byte-for-byte identical to upstream.
- **`smol-toml@1.7.0`** is an exact-pinned `devDependency`, imported only by `__test__/oracle.property.test.ts` as a **differential property-test oracle** (250 runs) — never a runtime dependency, never imported outside that one file. Corpus and oracle disagreement, if it ever occurs, is resolved with the corpus winning (it is the spec's own compliance suite); document the divergence rather than silently picking a side.
- The hostile-input suite (`__test__/hostile.test.ts`) exercises the guard surfaces in the previous section plus prototype-key handling (`__proto__` lands as an own data property, never polluting the prototype) and defect-passthrough.

## Deviations from a hypothetical "full spec + full parity" package

- **No `TomlParseOptions`.** `Toml.parse` takes no options — TOML 1.0.0 parsing has no knobs, unlike jsonc's error-recovery mode or yaml's multi-document handling. Do not add an options parameter speculatively; add it only when a real knob exists.
- **`U+FFFD` is rejected as `InvalidUtf8`.** The replacement character is treated as evidence of lossy decoding upstream (a prior UTF-8 decode step already lost information) rather than a legal source character. This is corpus-compliant — the toml-test suite expects this — but is a deliberate deviance from the RFC 3629 letter of "any Unicode scalar value is legal," worth knowing before "fixing" it to accept literal U+FFFD.
- **Nanosecond truncation beyond 9 fractional digits.** A `TomlLocalTime`/`TomlLocalDateTime`/`TomlOffsetDateTime` literal with more than 9 digits after the decimal point truncates to 9 (nanosecond resolution); it does not round or error.
- **`TomlEdit`/`TomlRange` are parity-identical to jsonc/yaml** (`{ offset, length, content }` / `{ offset, length }`) but two behaviors diverge:
  - `TomlFormat.format`'s `range` filter is an **owning-expression intersection** — an edit survives if its owning expression's span intersects the requested range at all — where yaml's equivalent requires the edit to fall **fully within** the range. Do not assume the two are interchangeable when porting range-filtering logic between packages.
  - `TomlEdit.applyAll` **rejects overlapping edits as a thrown defect**; yaml's `applyAll` does not perform this check. `TomlFormat` never produces overlapping edits itself, so this only fires on hand-constructed edit arrays — which is the point: it is a programmer-error guard, not a runtime input-hardening guard.
- **`TomlVisitor` construction is eager; enumeration is streamed.** `TomlVisitor.visit` parses, runs `analyze`, and sorts the full event list into document order **before** the `Stream` starts producing — `Stream.take` still short-circuits consumption, but it cannot skip the up-front parse/analyze/sort pass the way a truly lazy visitor could skip late document sections. Do not advertise early termination as an input-size optimization for this visitor; it isn't one.

## Public surface

Exported from `src/index.ts`:

- `Toml` — `parse`, `stringify` (`Effect`, failing with `TomlParseError`/`TomlStringifyError`); `fromString`, `TomlFromString`, `schema(target)`. Plus `TomlStringifyOptions` (the only knob: `newline`).
- `TomlDocument` — `parse`, `schema()`, `toValue()`, `stringify()` — the lossless document (`source`, `expressions`, `diagnostics`).
- `TomlEdit` (+ `applyAll`), `TomlRange`, `TomlPath`, `TomlSegment` — the edit vocabulary.
- `TomlFormat` — `format`/`formatToString` (pure, total), `modify`/`modifyToString` (`Effect`, failing with `TomlParseError`/`TomlModificationError`); `TomlFormattingOptions`.
- `TomlVisitor`, `TomlVisitorEvent` — SAX-style `Stream<TomlVisitorEvent, TomlParseError>` (`TableStart`/`ArrayTableStart`/`KeyValue`/`Comment`).
- `TomlDiagnostic` — `code`, `message`, `offset`/`length`, `line`/`character`; plus the five staged error-code unions: `TomlLexErrorCode`, `TomlParseErrorCode`, `TomlSemanticErrorCode`, `TomlStringifyErrorCode`, and the aggregate `TomlErrorCode`.
- `TomlLocalDate`, `TomlLocalTime`, `TomlLocalDateTime`, `TomlOffsetDateTime` — the four date-time value classes.
- The CST node classes (`TomlNode.ts`): `TomlKey`, `TomlKeyKind`, `TomlString`, `TomlStringStyle`, `TomlInteger`, `TomlFloat`, `TomlBoolean`, `TomlDateTimeLiteral`, `TomlArray`, `TomlInlineEntry`, `TomlInlineTable`, `TomlKeyValue`, `TomlTableHeader`, `TomlArrayTableHeader`, `TomlTrivia`, `TomlValueNode`, `TomlExpression`.

## Working here

```bash
pnpm vitest run packages/toml/__test__   # this package's tests
pnpm build --filter @effected/toml       # dev + prod, in order
```

Never run `node savvy.build.ts --target prod` directly. It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — never `expect`.

`savvy.build.ts` carries one narrow API Extractor suppression: `{ messageId: "ae-forgotten-export", pattern: "_base" }`, covering the heritage symbols synthesized by inline class factories (26 of them — the largest count in the repo, tracking the package's larger class surface). Never widen it. `package.json` stays `"private": true` — the bundler emits the publishable manifest.
