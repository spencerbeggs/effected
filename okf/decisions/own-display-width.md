---
type: Decision
title: The cli package owns its display-width function
description: Fmt measures display width with a short Intl.Segmenter plus emoji and East Asian Width range implementation checked by a differential test against string-width as a devDependency, rather than declaring string-width at runtime.
status: draft
tags: [architecture, bundle, deps]
sources:
  - id: string-width
    resource: npm:string-width
    title: string-width, the ecosystem oracle the differential test compares against
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T20:33:06Z
  body_sha256: 4a2886bba07afc93376d99c04e571bc0a7bfa644381cc4f535c345272e2745dd
---

# The cli package owns its display-width function

## Context

`Fmt.truncate` and the width-aware renderers need the display width of a
string: graphemes, wide East Asian characters and emoji count two columns,
combining marks and ANSI escapes count none. `string-width` is the ecosystem's
oracle,[^string-width] but `@effected/cli` is boundary tier and
[R1](../conventions/dependency-policy.md) forbids an external runtime
dependency there. A probe measured whether a small own implementation could
agree with it.

## Decision

The package carries about 16 lines of its own in
`packages/cli/src/internal/displayWidth.ts`: `Intl.Segmenter` for graphemes,
`\p{Emoji_Presentation}` and `\p{RGI_Emoji}` for emoji, a hand-kept East Asian
Width range table, and an ANSI stripper for CSI and OSC-8 sequences. A
differential test, the only file importing `string-width`, compares it against
the oracle. `string-width` is a `devDependency`.

## What the probe showed

The oracle was `string-width` 8.3.0 on a Node with `Intl.Segmenter` and
`\p{RGI_Emoji}` (the `v` flag needs Node 20 or later). The oracle's versions
disagree on one input: bare U+26A0 is 2 in 7.2.0 and 1 in 8.3.0, so the
differential test pins the oracle version it runs against. A control
confirmed the harness can report a mismatch.

**Curated strings: 29 of 29 match.** They include ASCII, precomposed and
decomposed accents, CJK, fullwidth Latin, halfwidth kana, Hangul, Thai, a
thumbs-up, a ZWJ family (2), a flag (2), a skin-tone emoji (2), a keycap (2),
VS16 symbols, a box-drawing run, an SGR-coloured string and an OSC-8 link.

**Code-point sweep, U+0000 to U+10FFFF.** The first candidate, which treated
the emoji blocks U+1F300 to U+1F64F and U+1F900 to U+1F9FF as blanket wide
ranges and listed only the four classic CJK blocks, had 13,601 mismatching
code points (8,764 of them assigned):

- about 8,400 astral wide scripts counted 1 instead of 2: Tangut, Khitan,
  Nushu, Kana Extended and Supplement, Tai Xuan Jing, the enclosed ideographic
  supplement;
- 119 BMP wide symbols: trigrams and hexagrams, the angle brackets U+2329 and
  U+232A, vertical forms, Hangul Jamo Extended-A;
- about 230 text-presentation pictographs counted 2 by the blanket emoji
  blocks (the thermometer U+1F321, the desktop U+1F5A5): the oracle counts
  them 1 bare and 2 only with VS16;
- four fillers (U+115F, U+1160, U+3164, U+FFA0) that should be 0.

The blanket emoji blocks were rejected because they cannot tell a
text-presentation pictograph from an emoji-presentation one;
`\p{Emoji_Presentation}` can. The final version uses it, adds the explicit
ranges above, and zeroes the Hangul fillers. **It leaves 26 mismatches, all
lone regional indicators U+1F1E6 to U+1F1FF** (oracle 1 bare, here 2).

**Composition fuzz: 50,000 seeded concatenations of 29 atoms.** 1,239
mismatches with a free-standing combining mark present, and 0 of 50,000
without. The only divergence is a bare combining mark glued after an emoji or
flag grapheme (a flag plus U+0E31): the oracle folds the whole grapheme to 1,
this counts 2.

### Known divergences

Both are documented and pinned in the differential test:

- a lone regional indicator, which the oracle counts as one column and this
  counts as two;
- a bare combining mark after an emoji or flag grapheme, counted 1 by the
  oracle and 2 here.

Ambiguous-width characters count one, as in the oracle, and a tab counts zero.

## Alternatives rejected

- **Declare `string-width` at runtime.** Rejected. It is an R1 violation for a
  boundary package, and it would pull `get-east-asian-width` and `strip-ansi`
  into every CLI's install for one helper.

## Consequences

The East Asian Width table is maintained by hand and will drift from Unicode;
the differential test is what catches it, and it is the price of the missing
dependency. `Intl.Segmenter` and `RGI_Emoji` follow the engine's Unicode
version, so a newer emoji can segment differently from the oracle's frozen
data, in either direction.

**If widths must agree exactly with a third-party renderer such as Ink (the
`./ui` subpath), declare `string-width` instead of owning the table, which is
a new Decision. Revisit in the P4 (`./ui`) design.**

[^string-width]: `npm:string-width`
