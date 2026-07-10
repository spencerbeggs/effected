---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-10
last-synced: 2026-07-10
completeness: 95
related:
  - ../effect-standards.md
  - ../migration-playbook.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - jsonc.md
  - yaml.md
  - glob.md
  - config-file.md
---

# @effected/toml design

## Overview

Target design for `@effected/toml`, the **eighth** package migration (config-file family slot 5d in [package-inventory.md](../package-inventory.md#the-config-file-family)) and a **pure-tier** package. Approved 2026-07-10; this design **reverses the 2026-07-09 rescope** that cut the package to a parse/stringify wrapper over a vendored smol-toml port. `@effected/toml` is a full-parity format sibling to `@effected/jsonc` ([jsonc.md](jsonc.md)) and `@effected/yaml` ([yaml.md](yaml.md)): parse, stringify, Schema integration, lossless CST, edit-in-place, formatter and visitor — built on a **from-scratch Effect-native engine**, not a smol-toml port. smol-toml appears only as a devDependency test oracle. The dialect target is **TOML 1.0.0 exactly**; no 1.1 draft features. Target directory is `packages/toml`.

The gate consumer is `@soda3js/config` ([releases.md](../releases.md#the-gate)), which uses parse/stringify only. The follow-on `@effected/config-file-toml` (family slot 5e) is a ~20-line `ConfigCodec` adapter over the stable seam in [config-file.md](config-file.md); it lives in its own package, and the dependency arrow points at toml, never from it.

Scale estimate: roughly 3–5k source lines and a few hundred hand-written tests on top of the ~870 vendored corpus fixtures — between jsonc (1,245 lines) and yaml (9,973) in engine scale.

## The headline decision: full parity, from-scratch

Two decisions from the 2026-07-09 rescope are reversed together, decided 2026-07-10:

- **Full parity, not parse/stringify-only.** The consumer contract (`@soda3js/config` imports exactly `parse` and `stringify`) still defines the **minimum** the package must satisfy — it just no longer bounds the surface. This is the same reasoning that made [glob](glob.md#the-headline-decision-a-full-fidelity-port) a full-fidelity port over the consumer-scoped alternative: a format package has predictable broader use across the five consuming applications, and the three format siblings (jsonc, yaml, toml) sharing the same surface contract — parse, stringify, Schema, lossless CST, edit, format, visitor — is itself load-bearing for codec-generic consumer code.
- **From-scratch Effect-native engine, not a smol-toml port.** smol-toml's design fights the house model in ways a port would have to fight back out: throw-based errors instead of typed diagnostics, a `TomlDate extends Date` hack for the four TOML datetime types (rejected — see [value model](#value-model)) and a lossy value-only parse with no CST. Writing the engine Effect-native from the start is cheaper than porting-then-rewriting, and TOML 1.0.0 is a small, stable, precisely specified grammar with a first-class compliance corpus — the conditions under which a from-scratch engine is a bounded bet rather than an open one. smol-toml survives as the differential-test oracle, the [glob/minimatch playbook](glob.md#testing).

## Tier and dependencies

Pure tier under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): `peerDependencies: { effect: "catalog:effect" }` and **zero runtime dependencies**. No IO, no services, no layers, no `R` anywhere — all inputs are strings, all outputs are values, documents, edits, streams or typed errors. Unlike jsonc, yaml and glob there is no vendored engine and no attribution burden: the engine is original work in `src/internal/`. `smol-toml` is pinned exact as a **devDependency only** (the test oracle). `"sideEffects": false`.

## Architecture: linear CST + semantic pass

TOML's syntax is flat — a linear sequence of key-value lines and `[table]` / `[[array-of-table]]` headers — while its semantics are a tree derived from those headers. The engine honors that split instead of forcing one shape onto both:

- **scanner → recursive-descent parser → lossless linear CST**: a flat list of expression nodes, each with source ranges and attached trivia (comments, whitespace, newlines).
- **A separate semantic pass** walks the expression list to build the logical table tree, enforcing TOML's redefinition rules — table redefinition, dotted-key collision, appending to inline tables, array-of-tables interleaving — and emitting typed diagnostics with line/column/range.
- **parse** = CST → semantic pass → plain values. **edit/format** operate on the linear CST: edits are text splices, naturally line-shaped. The **visitor** streams events from the semantic walk.

Two alternatives were considered and **rejected**:

- **Tree-shaped CST like jsonc's.** TOML's dotted keys, out-of-order headers and array-of-table headers scatter one logical node across non-contiguous source spans, so a tree CST makes edit and format fight the format instead of riding it.
- **Two engines** — a fast lossy value parser plus a separate CST layer. That is two grammar implementations to harden and keep in sync, and no throughput requirement justifies it.

## Module layout

One concern per file, mirroring [yaml's layout](yaml.md#module-layout-module-per-concept), per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept):

- `src/Toml.ts` — the value facade: `Toml.parse` (string → plain values), `Toml.stringify` (plain values → canonical TOML) and the schema factories — a `TomlFromString`-style codec for decoding config schemas straight from TOML text, the same DX as yaml. Owns the typed errors `TomlParseError` / `TomlStringifyError` and options classes for both directions.
- `src/TomlDateTime.ts` — four Effect Schema classes: `TomlOffsetDateTime`, `TomlLocalDateTime`, `TomlLocalDate`, `TomlLocalTime`. Structural equality, validation in `make` and arbitraries for free.
- `src/TomlDocument.ts` — the lossless document: linear expression CST plus the derived semantic table view plus recovered diagnostics.
- `src/TomlNode.ts` — the CST node classes. Expression level: `TomlKeyValue`, `TomlTableHeader`, `TomlArrayTableHeader` and comment/blank trivia. Value level: strings (all four TOML string forms, style preserved), scalars, `TomlArray`, `TomlInlineTable`.
- `src/TomlEdit.ts` — path-addressed edits (`TomlPath` / `TomlRange`) computed as text splices against the linear CST.
- `src/TomlFormat.ts` — non-mutating format/modify operations preserving comments and whitespace (the `YamlFormat` contract).
- `src/TomlVisitor.ts` — SAX-style event stream over the semantic walk.
- `src/TomlDiagnostic.ts` — the diagnostic class plus per-stage error-code enums: `TomlLexErrorCode`, `TomlParseErrorCode`, `TomlSemanticErrorCode`, `TomlStringifyErrorCode`.
- `src/index.ts` — the only barrel, re-exports only (the [no-barrel-re-exports rule](../effect-standards.md#no-barrel-re-exports)).
- `src/internal/` — scanner, parser, semantic pass, stringify engine and the hardening guards.

## Value model

Effect Schema classes throughout, decided against smol-toml's shapes:

- **Datetimes**: the four Schema classes in `TomlDateTime.ts`. Effect's `DateTime` module covers none of TOML's local-only types (local date-time, local date, local time), and smol-toml's `TomlDate extends Date` hack is **rejected** — a `Date` subclass cannot faithfully carry a timezone-free value.
- **Integers**: `number` within ±(2^53−1), `bigint` outside; 64-bit signed bounds are enforced per spec, and out-of-range fails typed.
- **Floats**: `number`, honoring TOML's `inf` / `nan` spellings.

The divergence from smol-toml's Date-subclass API is accepted: the `@soda3js/config` migration is a small mapping at its call sites, not a drop-in swap.

## Stringify: two distinct jobs, kept distinct

- **Value stringify**: plain JS values → canonical TOML. This is what `@soda3js/config` uses.
- **Document stringify**: CST → source text, **byte-exact round-trip** — parse then stringify of an untouched document returns the input verbatim.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) (the hardening-a-parser-port skill) apply in full and are **designed in, not retrofitted** — the from-scratch engine has no upstream guard inventory to inherit, so every guard is specified here:

- **Depth guards on every recursion surface**: value parse (inline tables and arrays nest arbitrarily), value stringify, document stringify, the visitor walk and edit-path resolution.
- **Prototype-pollution guards** on `__proto__` / `constructor` / `prototype` keys — TOML keys are attacker-controlled (the [yaml `__proto__` precedent](yaml.md#yamlnode-ast)).
- **Control-character rejection** in strings and comments per spec; `\u`/`\U` escape code-point validation (surrogate range, above U+10FFFF).
- Malformed input **always fails through the typed error channel** — never a defect, never a hang.

## Observability

Pure-tier house rule: named `Effect.fn` spans on the public fallible boundaries only. No per-node instrumentation inside the scanner, parser or semantic pass — hot recursive paths stay span-free, the yaml composer precedent. No metrics; telemetry-agnostic.

## Testing

`@effect/vitest`, `assert.*` — never `expect` — with tests in `__test__/` per repo convention. Three families:

1. **Compliance gate**: the BurntSushi toml-test 1.0.0 corpus (~500 valid + ~370 invalid cases), vendored as committed plain files pinned to a recorded upstream ref (the [yaml fixture-corpus precedent](yaml.md#fixture-corpus-and-compliance-harness)). Every valid case decodes to its expected typed value; every invalid case fails with a typed error.
2. **Differential property tests** against `smol-toml` pinned exact as the devDependency oracle (the [glob/minimatch playbook](glob.md#testing)), asserting parse agreement on generated documents modulo the documented value-model divergence.
3. **Hand-written suites** for what the corpus cannot see: CST fidelity (byte-exact round-trip), edit/format/visitor behavior, the datetime Schema classes and a hostile-input suite exercising every hardening guard above.

Resolved: the toml-test tagged-JSON mapping (`{"type": "datetime-local", "value": …}`) is compared **structurally** rather than through a hand-written tag table. Expected datetime strings are re-parsed through the scanner's own `classifyValueToken` and compared via `Equal.equals`; integers are BigInt-compared, accepting `number | bigint` on either side; no instant-equality fallback was needed. Resolved: `TomlEdit` insertion placement is pinned by test — root inserts go before the first header, after the last root expression; explicit `[t]` / `[[t]]`-element inserts go after that section's last expression, before the blank trivia separating sections; a dotted-created table gets a dotted key rendered **relative** to its defining section (`x.z = 2`, not `t.x.z = 2`); inline tables and header-implicit tables are not addressable for insertion and raise a typed `TomlModificationError`.

## Build and scaffold

Per [package-setup.md](../package-setup.md): copy a pure sibling (yaml) into `packages/toml`, with model paths `../../website/lib/models/toml` in `turbo.json` outputs and `savvy.build.ts` `localPaths`, and `repository.directory: packages/toml`. The Schema class factories need the narrow `_base` suppression in `savvy.build.ts` per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). devDependencies add `smol-toml` (the oracle), pinned exact. No `prepare` script — toml has no `workspace:*` deps; like glob it is a pure leaf.

## Consumer seam

`@effected/config-file-toml` (family slot 5e) implements `ConfigCodec` over `Toml.parse`/`Toml.stringify` in its own package — pure→pure `workspace:*`, following the `config-file-jsonc`/`config-file-yaml` shape. `@soda3js/config` then consumes `config-file`, `config-file-toml` and `toml` per [releases.md](../releases.md#the-five-applications). Nothing in toml knows about config-file.

## As built (2026-07-10)

The from-scratch engine merged on `feat/toml` with every gate green, promoting this doc to `current`. As-built notes against the design above:

**Gate results.** The BurntSushi toml-test v2.2.0 corpus (the files-toml-1.0.0 subset — 205 valid plus 474 invalid cases) passes 679/679 with no skip list; the design's ~500-valid/~370-invalid estimate was the full-corpus number, not the 1.0.0 subset. Byte-exact round-trip is proven over all 205 valid files. The `smol-toml` 1.7.0 differential oracle found zero divergences. The suite runs 1415 tests total, and `dist/prod/issues.json` reports zero errors, zero warnings, and a suppressed bucket holding only the 26 synthesized `_base` entries.

**G8 correction (corpus-driven).** The semantic pass was corrected against the corpus: headers pass **through** dotted-created intermediate tables (the spec's `fruit.apple.texture` example, where `[fruit.apple.texture]` is legal after `fruit.apple` was created by a dotted key). Only a header **landing** on a dotted-created table is illegal. The original redefinition-rule sketch conflated the two.

**Deviations from this design.** There is no `TomlParseOptions` class — TOML 1.0.0 parse has no knobs, so the options-class-per-direction sketch collapsed to a stringify-only options surface. U+FFFD is rejected as lossy-decode evidence via a new `InvalidUtf8` lex code (corpus-compliant); the documented trade-off is that a genuine U+FFFD scalar present in string input also rejects — a spec-edge cost accepted for corpus conformance. Fractional seconds truncate beyond nine digits (nanosecond precision).

**Emitter limits shared with every JS emitter.** An integral JS float emits as an integer (`1.0` becomes `1`), and an integral number past int64 emits as a TOML float so the output re-parses. These are floor limits of a JS-number-backed emitter, not toml-specific choices, and match what the oracle does.

**Parity notes.** `TomlEdit` and `TomlRange` are field-identical to `JsoncEdit`/`YamlEdit` (`{ offset, length, content }`, the parity convention). Two deliberate divergences from yaml are recorded so nobody "corrects" them: `TomlFormat.format`'s range filter uses owning-expression intersection (yaml uses edit-fully-within-range), because toml edits are line-shaped against the linear CST; and `TomlEdit.applyAll` rejects overlapping edits as a defect (yaml applies them), because overlapping splices against a linear CST are a caller wiring error, not recoverable input.

**Implementation notes.** Recursive `Schema.suspend` references are typed `Schema.Codec<T>` — the beta.94 documented idiom; `Schema.Schema<T>` leaves services `unknown` and breaks decode. `TomlVisitor` construction is eager (full parse plus semantic walk plus sort); only enumeration is streamed. Header and dotted-key depth is data, walked iteratively on both the parse and stringify sides — 5000-segment headers are fine; only value nesting recurses, under the 256-depth guard. `TomlDiagnostic.fromRaw` takes an inline public-shaped record (the yaml precedent) so no internal type leaks onto the API surface.
