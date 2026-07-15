---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-07-15
last-synced: 2026-07-15
completeness: 95
related:
  - ../effect-standards.md
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

`@effected/toml` is TOML 1.0.0 (no 1.1 draft features) as pure Effect Schema schemas on a **from-scratch, Effect-native engine**: parse, stringify, Schema integration, a lossless CST, edit-in-place, formatter and visitor. It is a full-parity format sibling of [@effected/jsonc](jsonc.md) and [@effected/yaml](yaml.md), sharing their surface contract (parse, stringify, Schema, lossless CST, edit, format, visitor). `smol-toml` appears only as a devDependency differential-test oracle.

## The headline decision: full parity, from-scratch

Two coupled decisions define the package:

- **Full parity, not parse/stringify-only.** The gate consumer (`@soda3js/config`, which imports exactly `parse` and `stringify`) defines the **minimum** the package must satisfy, not the maximum. This is the same reasoning that made [glob](glob.md#full-fidelity-port) a full-fidelity port: a format package has predictable broad use across the consuming applications, and the three format siblings sharing one surface contract is itself load-bearing for codec-generic consumer code.
- **From-scratch Effect-native engine, not a smol-toml port.** smol-toml fights the house model — throw-based errors instead of typed diagnostics, a `TomlDate extends Date` hack for the four datetime types (see [value model](#value-model)), and a lossy value-only parse with no CST. TOML 1.0.0 is a small, stable, precisely specified grammar with a first-class compliance corpus, which makes a from-scratch engine a bounded bet. smol-toml survives as the differential-test oracle.

## Tier and dependencies

Pure tier under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): `peerDependencies: { effect }` and **zero runtime dependencies**. No IO, no services, no layers, no `R` — all inputs are strings, all outputs are values, documents, edits, streams or typed errors. There is no vendored engine and no attribution burden; the engine is original work in `src/internal/`. `smol-toml` is pinned exact as a devDependency only. `"sideEffects": false`.

## Architecture: linear CST plus semantic pass

TOML's syntax is flat — a linear sequence of key-value lines and `[table]` / `[[array-of-table]]` headers — while its semantics are a tree derived from those headers. The engine honors the split:

- **scanner → recursive-descent parser → lossless linear CST**: a flat list of expression nodes, each with source ranges and attached trivia.
- **A separate semantic pass** walks the expression list to build the logical table tree, enforcing TOML's redefinition rules (table redefinition, dotted-key collision, appending to inline tables, array-of-tables interleaving) and emitting typed diagnostics with line/column/range.
- **parse** = CST → semantic pass → plain values. **edit/format** operate on the linear CST as text splices. The **visitor** streams events from the semantic walk.

A tree-shaped CST (like jsonc's) is rejected: TOML's dotted keys, out-of-order headers and array-of-table headers scatter one logical node across non-contiguous source spans, so a tree CST would make edit and format fight the format. Two separate engines (a fast lossy value parser plus a CST layer) are rejected too: two grammars to keep in sync with no throughput requirement justifying it.

## Module layout

One concern per file, mirroring [yaml's layout](yaml.md#module-layout):

- `src/Toml.ts` — the value facade: `Toml.parse` (string → plain values), `Toml.stringify` (plain values → canonical TOML) and the schema factories (a `TomlFromString`-style codec for decoding config schemas straight from TOML text). Owns the typed errors `TomlParseError` / `TomlStringifyError` and the stringify options.
- `src/TomlDateTime.ts` — four Effect Schema classes: `TomlOffsetDateTime`, `TomlLocalDateTime`, `TomlLocalDate`, `TomlLocalTime`, with structural equality, `make` validation and arbitraries.
- `src/TomlDocument.ts` — the lossless document: linear expression CST, derived semantic table view and recovered diagnostics.
- `src/TomlNode.ts` — the CST node classes: `TomlKeyValue`, `TomlTableHeader`, `TomlArrayTableHeader`, comment/blank trivia, and the value nodes (all four TOML string forms style-preserved, scalars, `TomlArray`, `TomlInlineTable`).
- `src/TomlEdit.ts` — path-addressed edits (`TomlPath` / `TomlRange`) computed as text splices against the linear CST.
- `src/TomlFormat.ts` — non-mutating format/modify operations preserving comments and whitespace.
- `src/TomlVisitor.ts` — SAX-style event stream over the semantic walk.
- `src/TomlDiagnostic.ts` — the diagnostic class plus per-stage error-code enums (`TomlLexErrorCode`, `TomlParseErrorCode`, `TomlSemanticErrorCode`, `TomlStringifyErrorCode`).
- `src/index.ts` — the only barrel, re-exports only.
- `src/internal/` — scanner, parser, semantic pass, stringify engine and the hardening guards.

## Value model

Effect Schema classes throughout:

- **Datetimes**: the four Schema classes in `TomlDateTime.ts`. Effect's `DateTime` module covers none of TOML's local-only types, and a `Date` subclass cannot faithfully carry a timezone-free value.
- **Integers**: `number` within ±(2^53−1), `bigint` outside; 64-bit signed bounds are enforced per spec, and out-of-range fails typed.
- **Floats**: `number`, honoring TOML's `inf` / `nan` spellings.

The divergence from smol-toml's Date-subclass API is deliberate: the `@soda3js/config` call sites map at their boundary rather than drop-in swapping.

## Stringify: two distinct jobs

- **Value stringify**: plain JS values → canonical TOML. This is what `@soda3js/config` uses.
- **Document stringify**: CST → source text, **byte-exact round-trip** — parse then stringify of an untouched document returns the input verbatim.

Two floor limits of a JS-number-backed emitter are shared with every JS emitter: an integral JS float emits as an integer (`1.0` becomes `1`), and an integral number past int64 emits as a TOML float so the output re-parses.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply in full — the from-scratch engine has no upstream guard inventory to inherit, so every guard is specified here:

- **Depth guards on every recursion surface**: value parse, value stringify, document stringify, the visitor walk and edit-path resolution. Value nesting recurses under a 256-depth guard; header and dotted-key depth is data walked iteratively on both the parse and stringify sides, so a 5000-segment header is fine.
- **Prototype-pollution guards** on `__proto__` / `constructor` / `prototype` keys — TOML keys are attacker-controlled.
- **Control-character rejection** in strings and comments per spec; `\u`/`\U` escape code-point validation (surrogate range, above U+10FFFF).
- **U+FFFD is rejected** as lossy-decode evidence via an `InvalidUtf8` lex code. The accepted spec-edge cost: a genuine U+FFFD scalar present in string input also rejects.
- **Fractional seconds truncate** beyond nine digits (nanosecond precision).
- Malformed input **always fails through the typed error channel** — never a defect, never a hang.

The semantic pass distinguishes two cases the redefinition rules can conflate: a header **passes through** dotted-created intermediate tables (`[fruit.apple.texture]` is legal after `fruit.apple` was created by a dotted key), while a header **landing** on a dotted-created table is illegal.

## Observability

Pure-tier rule: named `Effect.fn` spans on the public fallible boundaries only. No per-node instrumentation inside the scanner, parser or semantic pass. No metrics; telemetry-agnostic.

## Testing

`@effect/vitest`, `assert.*` — never `expect` — with tests in `__test__/`. Three families:

1. **Compliance gate**: the BurntSushi toml-test corpus (the files-toml-1.0.0 subset), vendored as committed plain files pinned to a recorded upstream ref. It passes in full with no skip list; byte-exact round-trip is proven over every valid corpus file.
2. **Differential property tests** against the `smol-toml` oracle, asserting parse agreement modulo the documented value-model divergence.
3. **Hand-written suites** for what the corpus cannot see: CST fidelity, edit/format/visitor behavior, the datetime Schema classes and a hostile-input suite exercising every hardening guard.

The toml-test tagged-JSON mapping (`{"type": "datetime-local", "value": …}`) is compared **structurally**: expected datetime strings are re-parsed through the scanner's own `classifyValueToken` and compared via `Equal.equals`; integers are BigInt-compared. `TomlEdit` insertion placement is pinned by test: root inserts go before the first header / after the last root expression; explicit `[t]` / `[[t]]`-element inserts go after that section's last expression; a dotted-created table gets a dotted key rendered relative to its defining section; inline tables and header-implicit tables are not addressable for insertion and raise `TomlModificationError`.

## Consumer seam

`TomlCodec` implements `@effected/config-file`'s `ConfigCodec` over `Toml.parse`/`Toml.stringify`. It lives inside `@effected/config-file` as one of four free-standing codec exports — see [the config-file codecs](config-file.md). `@soda3js/config` therefore consumes `config-file` and `toml`. **Nothing in toml knows about config-file**: the edge is config-file → toml, a `workspace:*` peer, and this package stays a pure, unaware format package.

## Parity and implementation notes

- `TomlEdit` and `TomlRange` are field-identical to `JsoncEdit`/`YamlEdit` (`{ offset, length, content }`, the parity convention). Two deliberate divergences from yaml: `TomlFormat.format`'s range filter uses owning-expression intersection (toml edits are line-shaped against the linear CST), and `TomlEdit.applyAll` rejects overlapping edits as a defect (overlapping splices against a linear CST are a caller wiring error, not recoverable input).
- Parse has **no options class** — TOML 1.0.0 parse has no knobs, so only the stringify direction carries an options surface.
- Recursive `Schema.suspend` references are typed `Schema.Codec<T>`; `Schema.Schema<T>` leaves services `unknown` and breaks decode.
- `TomlVisitor` construction is eager (full parse plus semantic walk plus sort); only enumeration is streamed.
- `TomlDiagnostic.fromRaw` takes an inline public-shaped record so no internal type leaks onto the API surface.

## Build and scaffold

Per [package-setup.md](../package-setup.md): copied from a pure sibling (yaml), with model paths `../../website/lib/models/toml` in `turbo.json` outputs and `savvy.build.ts` `localPaths`, and `repository.directory: packages/toml`. The Schema class factories need the narrow `_base` suppression in `savvy.build.ts` per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). devDependencies add `smol-toml` (the oracle), pinned exact. No `prepare` script — toml is a pure leaf with no `workspace:*` deps.
