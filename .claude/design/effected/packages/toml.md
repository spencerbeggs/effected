---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-08-25
last-synced: 2026-09-02
completeness: 95
related:
  - ../effect-standards.md
  - ../formatter-convention.md
  - ../package-inventory.md
  - ../package-setup.md
  - jsonc.md
  - yaml.md
  - markdown.md
  - glob.md
  - config-file.md
---

# @effected/toml design

## Overview

`@effected/toml` is TOML 1.1.0 as pure Effect schemas on a **from-scratch, Effect-native engine**: parse, stringify, Schema integration, a lossless CST, edit-in-place, formatter and visitor. It is a full-parity format sibling of [jsonc](jsonc.md), [yaml](yaml.md) and [markdown](markdown.md), sharing their surface contract. `smol-toml` appears only as a devDependency differential-test oracle.

## The headline decision: full parity, from-scratch

Two coupled decisions define the package.

**Full parity, not parse/stringify-only.** A format package has predictable broad use across the consuming applications, and the format siblings sharing one surface contract is itself load-bearing for codec-generic consumer code. The first consumer's needs define the *minimum* a format package satisfies, never the maximum — the same reasoning that made [glob](glob.md#full-fidelity-port) a full-fidelity port.

**A from-scratch engine, not a smol-toml port.** smol-toml fights the house model: throw-based errors instead of typed diagnostics, a `Date` subclass for the four datetime types and a lossy value-only parse with no CST. TOML is a small, stable, precisely specified grammar with a first-class compliance corpus, which makes a from-scratch engine a bounded bet. It is the first format package in the repo with **no vendored code** and therefore no attribution burden; smol-toml survives as the oracle.

## Tier and dependencies

Pure tier under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): `effect` as the only peer and **zero runtime dependencies**. No IO, no services, no layers, no `R` — all inputs are strings, all outputs are values, documents, edits, streams or typed errors. `smol-toml` is pinned exact as a devDependency only. `"sideEffects": false`.

## Architecture: linear CST plus semantic pass

TOML's syntax is flat — a linear sequence of key-value lines and `[table]` / `[[array-of-table]]` headers — while its semantics are a tree derived from those headers. The engine honors the split rather than papering over it:

- **scanner → recursive-descent parser → lossless linear CST**: a flat list of expression nodes whose spans **tile the source exactly**, each carrying attached trivia.
- **A separate semantic pass** walks that list to build the logical table tree, enforcing TOML's redefinition rules — table redefinition, dotted-key collision, appending to inline tables, array-of-tables interleaving — and emitting typed diagnostics with line, column and range.
- Value parse is CST → semantic pass → plain values; edit and format operate on the linear CST as text splices; the visitor streams events from the semantic walk.

The exact tiling is the round-trip proof: document stringify reconstructs the source by concatenating each expression's slice, so there is no separate re-serialization path to drift from the source.

A tree-shaped CST like jsonc's is rejected: TOML's dotted keys, out-of-order headers and array-of-table headers scatter one logical node across non-contiguous source spans, so a tree CST would make edit and format fight the format. Two separate engines — a fast lossy value parser plus a CST layer — are rejected too: two grammars to keep in sync with no throughput requirement justifying it.

Modification runs a **third** walk over the same expression list, purpose-built, because it needs a resolution tree with insertion points that the semantic pass's callback-only walk does not carry.

## Module layout

One concern per file, mirroring [yaml's layout](yaml.md#module-layout): a value facade (`Toml.ts`), the four datetime classes, the lossless document, the CST node classes, the edit vocabulary, format, visitor and diagnostics, with the engine under `src/internal/`. `src/index.ts` is the only barrel.

### Cycle firewall

`noImportCycles` is error-level, held by one rule: `src/internal/` throws **raw carriers** — a raw error record and a guard-exceeded signal — and never imports a public module. The public modules catch those throws and materialize `TomlDiagnostic` (deriving `line`/`character` from `offset`) plus the tagged errors.

The one sanctioned exception is that the engine may import the CST node classes and the four datetime value classes, because both are leaves that import only `effect` (and, for the nodes, the datetimes), so importing them from `internal/` cannot close a cycle back into the facade. Nothing else under `src/*.ts` is a legal engine import.

Defect passthrough is **proven, not assumed**: every `catch` in the facade tests for the two raw carriers and rethrows anything else, so a genuine programmer-error defect is never silently swallowed into a typed error channel it does not belong in.

## TOML 1.1.0

The engine parses TOML 1.1.0, and there is **no version option** — see [no knobs](#implementation-notes). The relaxations that matter when reading the grammar code:

- `\e` (U+001B) and `\xHH` escapes. `\xHH` deliberately **bypasses the control-character ban**: `\x07` is legal where a literal control byte is not, the same carve-out `\u`/`\U` already had.
- Newlines and comments inside inline tables, via a shared value-gap production applied at every inline-table and array value gap, plus a trailing comma in inline tables.
- Optional seconds in times, with the secfrac group nested **inside** the seconds group per the ABNF. So `07:32` is valid and `07:32.5` is **invalid** — a fractional part with no seconds has nowhere to attach. An absent seconds group materializes as `0`.

**Unicode bare keys are not in released 1.1** — they were dropped before release and are not implemented here.

**Liberal read, conservative write.** `stringify` keeps 1.0.0 spellings: seconds always emitted, no `\e` or `\xHH`, no trailing comma, single-line inline tables. Every emitted document is therefore valid under both specs. The asymmetry is the point, not an omission, and it is safe in one direction only — do not "modernize" the emitter for symmetry. Document round-tripping preserves 1.1 spellings regardless, because it replays source text; only *value* stringify normalizes.

## Value model

Effect Schema classes throughout.

**Datetimes** are four `Schema.Class` value objects, none subclassing JS `Date`. Effect's `DateTime` module has no local-only (offset-free, timezone-free) variant, and a `Date` subclass cannot faithfully carry a timezone-free value. They validate against the real Gregorian calendar, leap years included, and get structural equality for free.

**Integers** split at `±(2^53 − 1)`: within that range a TOML integer decodes to a JS `number`, beyond it to a `bigint`. Both sides are bounds-checked against TOML's 64-bit signed range, on parse and on stringify.

**Floats** are `number`, honoring TOML's `inf` and `nan` spellings. Two floor limits of a JS-number-backed emitter follow and are shared with every JS TOML emitter: an integral float emits as an integer, because JS cannot tag a `number` as float-typed once it holds an integral value; and an integral number past int64 range emits as a TOML float so the output re-parses. There is no representable fix without a wrapper type this package deliberately does not add.

The divergence from smol-toml's `Date`-subclass API is deliberate — consumers map at their own boundary rather than drop-in swapping.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply in full. The from-scratch engine has no upstream guard inventory to inherit, so every guard is specified here. Malformed input **always fails through the typed channel** — never a defect, never a hang.

Arrays and inline tables are the only genuinely recursive value shapes, so a shared depth cap is enforced independently on both sides of the codec — parse descent and stringify descent — plus an explicit length check on the modification path's caller-supplied key path, so an attacker-controlled path array cannot force unbounded navigation.

**Header and dotted-key nesting is deliberately not guarded, because it is not recursion.** Table headers and dotted keys are parsed and navigated **iteratively**; a header with thousands of segments resolves fine, and there is no stack to blow. Know this before "fixing" header depth to match the value cap — that would be defending against a cost that does not exist.

The remaining guards: prototype-pollution keys are neutralized (TOML keys are attacker-controlled, and `__proto__` lands as an own data property); control characters are rejected in strings and comments per spec, with escapes the deliberate carve-out; escape code points are validated against the surrogate range and the Unicode maximum; fractional seconds truncate beyond nanosecond precision rather than rounding or erroring.

**U+FFFD is rejected** as evidence of a lossy upstream decode. This is corpus-compliant but a deliberate deviance from the RFC 3629 letter that any Unicode scalar value is legal, and it costs a genuine U+FFFD scalar in string input. Worth knowing before "fixing" it.

The semantic pass distinguishes two cases the redefinition rules can conflate: a header **passes through** dotted-created intermediate tables legally, while a header **landing** on a dotted-created table is illegal.

## Testing

`@effect/vitest`, `assert.*` — never `expect` — with tests in `__test__/`. Three families, none a substitute for another:

1. **The compliance gate**: the BurntSushi toml-test 1.1.0 corpus, vendored as committed plain files pinned to a recorded upstream ref, passing in full with **no skip list**. Byte-exact round-trip is proven over every valid corpus file. The corpus tree carries its own `.gitattributes` disabling text normalization, because several fixtures deliberately embed bare CR/CRLF bytes and must stay byte-identical to upstream.
2. **Differential property tests** against the exact-pinned `smol-toml` oracle, asserting parse agreement modulo the documented value-model divergence. The expected-divergence set is **empty**, and the assertion pins that. Should corpus and oracle ever disagree, the corpus wins — it is the spec's own compliance suite — and the divergence gets documented rather than silently resolved.
3. **Hand-written suites** for what the corpus cannot see: CST fidelity, edit/format/visitor behavior, the datetime classes and a hostile-input suite exercising every guard above plus defect passthrough.

Corpus comparison is **structural**, not textual: expected datetime strings are re-parsed through the scanner's own classifier and compared with `Equal.equals`; integers are BigInt-compared.

## Consumer seam

`TomlCodec` implements [config-file](config-file.md)'s `ConfigCodec` over this package's parse and stringify. It lives inside `@effected/config-file` as one of four free-standing codec exports, reached through a `workspace:^` peer. **Nothing in toml knows about config-file**: the edge points config-file → toml, and this package stays a pure, unaware format package.

## Implementation notes

- **Parse has no options class.** TOML parsing has no knobs, unlike jsonc's error-recovery mode or yaml's multi-document handling, so only the stringify direction carries an options surface. A spec-version knob was considered and rejected: it would fork the grammar, the corpus and every error-code union to serve no identified consumer. Do not add an options parameter speculatively.
- **The edit vocabulary is parity-identical** to its jsonc, yaml and markdown counterparts, and `applyAll` rejects overlapping edits as a defect like all four siblings do — a programmer-error guard on hand-constructed arrays, since format never produces overlapping edits itself. One behavior still diverges: `TomlFormat.format`'s range filter uses **owning-expression intersection**, where yaml's equivalent requires the edit to fall fully within the range. Do not assume the two are interchangeable when porting range-filtering logic.
- **`Result` is the primitive.** `parseResult` and `stringifyResult` hold the engine; the `Effect` forms are `Effect.fromResult` over them behind their existing spans, so the two cannot drift. Never re-derive the engine on the `Effect` side. Kit convention — [formatter-convention.md](../formatter-convention.md), decision 6.
- **`bind(Target)`** returns `{ schema, decode, encode }`, thin sugar over `schema(Target)` with **no new error taxonomy**. It lands identically in jsonc, yaml and toml, so the bound-codec shape joins the parity surface; yaml's single-document restriction is the sole cross-package asymmetry. Schema-producing, like `fromString` and `schema` — bind the result to a `const` on a hot path.
- **Recursive `Schema.suspend` references are typed `Schema.Codec<T>`.** `Schema.Schema<T>` leaves services `unknown` and breaks decode.
- **`TomlVisitor` construction is eager; only enumeration is streamed.** It parses, analyzes and sorts the full event list into document order before the stream produces anything. `Stream.take` still short-circuits consumption, but it cannot skip the up-front pass — do not advertise early termination as an input-size optimization for this visitor.
- **`TomlDiagnostic`'s raw constructor takes an inline public-shaped record**, so no internal type leaks onto the API surface.

## Observability

Pure-tier rule: named `Effect.fn` spans on the public fallible boundaries only. No per-node instrumentation inside the scanner, parser or semantic pass. No metrics; telemetry-agnostic.

## Build and scaffold

Per [package-setup.md](../package-setup.md), scaffolded from a pure sibling with the api-extractor model wired at `website/lib/models/toml` in both `turbo.json` outputs and `savvy.build.ts`. The Schema class factories need the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), one entry per class factory and no wider.
