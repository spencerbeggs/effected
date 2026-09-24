---
type: Interface
title: "@effected/yaml stringify options"
description: The emitter's optional presentation and compatibility behaviours -- indentSequences, explicit-key spill, lineWidth folding, requoteScalars and quoteCompat.
status: stable
kind: api
resource: ../../packages/yaml/src/YamlFormat.ts
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: ed917dc3b3464f0209032fa7234e8028d917930b116f951881be977e89ade4cc
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:12.812Z
---

# @effected/yaml stringify options

The emitter's optional behaviours — how a nested sequence is indented, when
a long key spills into explicit form, when a long scalar folds, whether
already-quoted scalars are re-quoted, and how far to quote for a YAML 1.1
consumer. They share one property that is the reason to read them together:
every default keeps output byte-identical to what a caller already gets,
because [`@effected/yaml`](../modules/yaml.md)'s stringifier is
byte-compatible with its source dialect and a cosmetic default is not worth
a diff in every downstream repo.

The options themselves are `YamlStringifyOptions` (`src/Yaml.ts`) and
`YamlFormattingOptions` (`src/YamlFormat.ts`); the emitter is
`src/internal/stringifier.ts`, with folding in `src/internal/fold.ts` and
re-quoting in `src/internal/requote.ts`. How the two option classes relate
is described in [the yaml Module's options-derivation
section](../modules/yaml.md#jsoncyaml-parity-reconciliation).

## indentSequences — presentation, not fidelity

Controls how a block sequence nested under a mapping key is presented: at
the key's column, or indented one level (the shape the `yaml` npm package
and prettier default to). Top-level sequences sit at column zero either way.

The default is `false`, and the default is the whole decision. Both forms
are valid YAML parsing to identical data, so this is presentation, not
semantics — but flipping a default that changes bytes would rewrite
sequence indentation in every file every existing consumer round-trips.
Consumers who want the popular shape ask for it.

The explicit-key compact-sequence branch is deliberately untouched by the
option. `? key` / `: value` syntax is a different construct with its own
emitter path, and folding it under the same flag would change a form nobody
asked about while chasing the common one. That branch is a *destination* of
the spill below, not a thing the option steers — do not conflate the two.

## lineWidth — value-path-only by contract

A positive `lineWidth` folds long **plain**, **double-quoted** and
**block-folded** scalars at approximately that column, inserting only
semantically transparent breaks — ones a reader folds back to a single
space, so the round-trip is preserved. Block-literal and single-quoted
scalars are never folded: literal blocks preserve their bytes by
definition, and single-quoted folding is out of scope. Flow-collection
items pass `allowFold=false`, because they are re-joined with spaces and a
fold break would corrupt them.

The default is `0` — never wrap — and, as with `indentSequences`, the
default is the decision. It is what keeps default output byte-identical and
the compliance harness at 100%: nothing folds unless a caller asks.

**Value-path-only is the documented contract, not a gap.** Only
`Yaml.stringify` and `Yaml.stringifyResult` fold. The document and node path
threads `lineWidth` into its render context but never reads it, and the
schema factories encode with default stringify options, so neither ever
folds. The TSDoc states the boundary and steers node-path callers to
`Yaml.stringify(doc.toValue(), options)`, and a regression test pins the
node path's inertness — so folding cannot land there without failing that
test and rewriting the docs with it.

## Explicit-key spill — the implicit-key limit

See [the explicit-key spill limitation](../limitations/yaml-explicit-key-spill.md)
for the bound itself and what a caller sees when it fires.

## requoteScalars — opt-in re-quoting on the format path

On the format path, `quoteStyle` governs only quotes the stringifier
*introduces* — it never re-quotes scalars already quoted in the source.
That source-preserving default is a contract consumers rely on and does not
change; `requoteScalars` (default `false`, on `YamlFormattingOptions`,
`src/YamlFormat.ts:95`) is the opt-in that makes `quoteStyle` apply to
already-quoted source scalars too, which is the behavior an ex-Prettier
consumer expects from `singleQuote: false`.

**A companion boolean, not a widened value space.** The alternative spelling
— a `"double-requote"` value on `quoteStyle` — is rejected because an
option value should not encode two axes. When `quoteStyle` is omitted the
fallback is `"single"`, so `requoteScalars` alone converts double→single;
the option's TSDoc says so, and the README's "Migrating from Prettier"
table maps `singleQuote` onto the pair.

**Semantics-preserving or skip.** Re-quoting never changes the parsed
value. Single→double applies double-quote escaping to the content;
double→single is impossible when the content needs escapes single quotes
cannot express (control characters and the like) — such scalars stay
untouched rather than corrupted. Plain scalars stay plain: this is
quote-style normalization, not forcing quotes. Comment and byte fidelity
elsewhere is unchanged, because the edit is a surgical `YamlEdit` per
scalar span.

**Lint symmetry, with the lint fix deliberately conservative.**
`src/internal/requote.ts` carries both surfaces behind one helper
(`requoteScalarText`) with two modes. `"conservative"` is the
[`quoted-strings` lint fix's](yaml-lint.md) semantics — it bails whenever
escapes are in play — and `"escaping"` is the format path's wider
transform. The two surfaces agree on what "re-quotable" means because both
delegate to that helper; the escaping mode belongs only to the format path.

**Composition guarantee.** Escaping mode's replacement text comes from the
stringifier's own `renderDoubleQuoted` / `renderSingleQuoted`, and the
format path uses the helper as the re-quotable predicate and flips the
node's `style` — the stringifier then emits through those same renderers,
so flip-and-stringify and the helper's replacement cannot disagree.

## quoteCompat — quoting for a YAML 1.1 resolver

`YamlStringifyOptions.quoteCompat`, currently the single-member
`"yaml-1.1"`, additionally quotes a plain scalar that a YAML **1.1**
resolver (js-yaml, PyYAML, libyaml) would implicitly coerce to a
non-string but the 1.2 Core Schema rules do not: the extended boolean
spellings (`y`/`yes`/`on`/`off` and case variants — the "Norway problem"),
1.1's timestamp grammar including its space-separated forms, sexagesimal
numbers (`1:30`), underscore-separated digits (`1_000`) and the base-2/8/16
integer forms. `src/internal/stringifier.ts`'s `wouldBeResolved11` carries
the pattern set and deliberately over-quotes at every spec/real-world-
resolver seam — over-quoting is the safe direction for a compat mode, never
under.

**Strictly additive, exactly like `indentSequences`'s default-off posture.**
Absent (the default) it changes nothing, and set, it can only add quotes
the 1.2 rules did not already require; it can never un-quote anything, and
a scalar carrying an explicit tag is exempt on the same terms as the 1.2
type-conflict check. It threads through `requiresQuoting`'s existing single
gate rather than a parallel check, so the two dialects' rules can never
disagree about which characters win when both would quote.

## The three stringify-input adapters are a maintenance hazard

See [the adapters gotcha](../gotchas/yaml-three-stringify-adapters.md) for
what a reader sees when one adapter is updated for a new option field and
the others are not.
