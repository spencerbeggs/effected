---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-09-02
completeness: 95
related:
  - yaml.md
  - yaml-comments.md
  - ../formatter-convention.md
  - jsonc.md
---

# @effected/yaml — stringify presentation and compatibility options

## Overview

The emitter's optional behaviours — how a nested sequence is indented, when a long key spills into explicit form, when a long scalar folds, whether already-quoted scalars are re-quoted, and how far to quote for a YAML 1.1 consumer. They share one property that is the reason to read them together: **every default keeps output byte-identical to what a caller already gets**, because [`@effected/yaml`](yaml.md)'s stringifier is byte-compatible with its source dialect and a cosmetic default is not worth a diff in every downstream repo.

The options themselves are `YamlStringifyOptions` and `YamlFormattingOptions`; the emitter is `src/internal/stringifier.ts`, with folding in `internal/fold.ts` and re-quoting in `internal/requote.ts`. How the two option classes relate is [the parity reconciliation](yaml.md#options-derivation).

## indentSequences — presentation, not fidelity

Controls how a block sequence nested under a mapping key is presented: at the key's column, or indented one level (the shape the `yaml` npm package and prettier default to). Top-level sequences sit at column zero either way.

**The default is `false`, and the default is the whole decision.** Both forms are valid YAML parsing to identical data, so this is presentation, not semantics — but flipping a default that changes *bytes* would rewrite sequence indentation in every file every existing consumer round-trips. Consumers who want the popular shape ask for it.

The **explicit-key compact-sequence branch is deliberately untouched** by the option. `? key` / `: value` syntax is a different construct with its own emitter path, and folding it under the same flag would change a form nobody asked about while chasing the common one. That branch is a *destination* of the spill below, not a thing the option steers — do not conflate the two.

## Explicit-key spill — the implicit-key limit

YAML 1.2 §8.1.3 caps an implicit block-mapping key: the `:` indicator must appear at most 1024 characters after the key's start. Both stringify paths — value and node — therefore **spill** a block-mapping key whose **rendered** form exceeds that limit into explicit-key form, `? key` on its own line and `: value` on the next.

Three parts of that are precise on purpose. The measure is the **rendered** key, not the source scalar — quotes and escapes are what a parser counts. The threshold is **strictly greater than** 1024, matching the reference `yaml` package (a rendered key of exactly 1024 stays implicit), because an off-by-one here is the difference between agreeing with every other implementation and producing output they read differently. And the spill is **block-context only**: flow contexts never spill, since flow mappings have no implicit-key line to overrun. Without the spill the emitter produced output that strict parsers reject — a correctness bug against the reference, not a style difference. The real-world input class is the pnpm 11 lockfile `snapshots:` shape.

**`EXPLICIT_COMPACT_PAD` is a recorded divergence from the reference.** Compact continuation lines — the lines after `: first-item` / `? first-line` — are padded with a **structural two columns** (an indicator character plus its space, `?` or `:`), never the configured `indent`. The reference pads them with the configured indent, and at `indent ≠ 2` its own strict parser then misreads the sequence output (items merge into one scalar) or rejects the mapping output outright. Compact continuation lines must align with the first item, which always begins two columns in; any other pad silently re-nests or corrupts the value on reparse. The house [fidelity obligation](../formatter-convention.md#decision-5--the-fidelity-obligation) says our emit must reparse to the same document, so where the oracle contradicts its own parser we follow the spec and record the divergence rather than reproducing the bug.

Byte-pinned fixtures under `__test__/fixtures/explicit-key/` pin the emit, including both sides of the 1024/1025 boundary. They were authored **once** against `yaml@2.9.0` as a strict oracle in a scratch directory outside the repo, with provenance recorded in that directory's `ORACLE.md`; the committed bytes are the contract thereafter and the reference package is not a dependency of the test run.

## lineWidth — value-path-only by contract

A positive `lineWidth` folds long **plain**, **double-quoted** and **block-folded** scalars at approximately that column, inserting only semantically transparent breaks — ones a reader folds back to a single space, so the round-trip is preserved. **Block-literal and single-quoted scalars are never folded**: literal blocks preserve their bytes by definition, and single-quoted folding is out of scope. Flow-collection items pass `allowFold=false`, because they are re-joined with spaces and a fold break would corrupt them.

The default is `0` — never wrap — and as with `indentSequences` the default is the decision. It is what keeps default output byte-identical and [the compliance harness](yaml.md#fixture-corpus-and-compliance-harness) at 100%: nothing folds unless a caller asks.

**Value-path-only is the documented contract, not a gap.** Only `Yaml.stringify` and `Yaml.stringifyResult` fold. The document and node path threads `lineWidth` into its render context but never reads it, and the schema factories encode with default stringify options, so neither ever folds. The TSDoc states the boundary and steers node-path callers to `Yaml.stringify(doc.toValue(), options)`, and a regression test pins the node path's inertness — so folding cannot land there without failing that test and rewriting the docs with it.

## requoteScalars — opt-in re-quoting on the format path

On the format path, `quoteStyle` governs only quotes the stringifier *introduces* — it never re-quotes scalars already quoted in the source. That source-preserving default is a contract consumers rely on and does not change; `requoteScalars` (default `false`) on `YamlFormattingOptions` is the opt-in that makes `quoteStyle` apply to already-quoted source scalars too, which is the behavior an ex-Prettier consumer expects from `singleQuote: false`.

**A companion boolean, not a widened value space.** The alternative spelling — a `"double-requote"` value on `quoteStyle` — is rejected because an option value should not encode two axes. When `quoteStyle` is omitted the fallback is `"single"`, so `requoteScalars` alone converts double→single; the option's TSDoc says so, and the README's "Migrating from Prettier" table maps `singleQuote` onto the pair.

**Semantics-preserving or skip.** Re-quoting never changes the parsed value. Single→double applies double-quote escaping to the content; double→single is impossible when the content needs escapes single quotes cannot express (control characters and the like) — such scalars stay **untouched rather than corrupted**. Plain scalars stay plain: this is quote-style normalization, not forcing quotes. Comment and byte fidelity elsewhere is unchanged, because the edit is a surgical `YamlEdit` per scalar span.

**Lint symmetry, with the lint fix deliberately conservative.** `internal/requote.ts` carries both surfaces behind one helper with two modes. `"conservative"` is the [`quoted-strings` lint fix](../yaml-lint.md)'s semantics — it bails whenever escapes are in play — and `"escaping"` is the format path's wider transform. The two surfaces agree on what "re-quotable" means because both delegate to that helper; the escaping mode belongs only to the format path.

**Composition guarantee.** Escaping mode's replacement text comes from the stringifier's own `renderDoubleQuoted` / `renderSingleQuoted`, and the format path uses the helper as the re-quotable predicate and flips the node's `style` — the stringifier then emits through those same renderers, so flip-and-stringify and the helper's replacement cannot disagree.

## quoteCompat — quoting for a YAML 1.1 resolver

`YamlStringifyOptions.quoteCompat`, currently the single-member `"yaml-1.1"`, additionally quotes a plain scalar that a YAML **1.1** resolver (js-yaml, PyYAML, libyaml) would implicitly coerce to a non-string but the 1.2 Core Schema rules do not: the extended boolean spellings (`y`/`yes`/`on`/`off` and case variants — the "Norway problem"), 1.1's timestamp grammar including its space-separated forms, sexagesimal numbers (`1:30`), underscore-separated digits (`1_000`) and the base-2/8/16 integer forms. `internal/stringifier.ts`'s `wouldBeResolved11` carries the pattern set and deliberately **over-quotes at every spec/real-world-resolver seam** — over-quoting is the safe direction for a compat mode, never under.

**Strictly additive, exactly like `indentSequences`'s default-off posture.** Absent (the default) it changes nothing, and set, it can only add quotes the 1.2 rules did not already require; it can never un-quote anything, and a scalar carrying an explicit tag is exempt on the same terms as the 1.2 type-conflict check. It threads through `requiresQuoting`'s existing single gate rather than a parallel check, so the two dialects' rules can never disagree about which characters win when both would quote.

## The three stringify-input adapters are a maintenance hazard

`Yaml.ts`, `YamlDocument.ts` and `YamlFormat.ts` each hand-copy `YamlStringifyOptions` onto the engine's `StringifyOptionsInput` field-by-field rather than through one shared mapping function. **Every new `YamlStringifyOptions` field must be added to all three by hand, and nothing enforces that structurally** — unlike `YamlFormattingOptions`, which derives its shared fields from `YamlStringifyOptions.fields` by spread precisely to avoid this class ([options derivation](yaml.md#options-derivation)).

The hazard is not hypothetical: `YamlDocument.ts`'s adapter once silently dropped `quoteStyle`, so a document-path caller setting it got the `"single"` fallback regardless of what they passed. All three adapters now forward the full set, with a node-path regression test pinning `YamlDocument#stringify` under `quoteStyle: "double"`. Treat that test as the tripwire for the next field added.
