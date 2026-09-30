---
type: Decision
title: The cli package owns its display-width function
description: Fmt measures display width with a short Intl.Segmenter plus emoji and East Asian Width range implementation checked by a differential test against string-width as a devDependency, rather than declaring string-width at runtime.
status: draft
tags: [architecture, bundle, deps]
sources:
  - id: interactive-cli-kit-design
    resource: ../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md
    title: Interactive CLI kit design, sections 5.7 and 11
  - id: p2-probe-display-width
    resource: probe P5 of the P2 plan, run against string-width 8.3.0 on Node 26
    title: "Probe P5: display width without a dependency"
generated:
  by: "okfit/claude-code"
  at: 2026-09-30T20:28:29Z
  body_sha256: 82fc39e0cd0d47feb6ab94110918dee589ee432c97a08bec0238c416f126c988
---

# The cli package owns its display-width function

## Context

`Fmt.truncate` and the width-aware renderers need the display width of a
string: graphemes, wide East Asian characters and emoji count two columns,
combining marks and ANSI escapes count none.[^interactive-cli-kit-design]
`string-width` is the ecosystem's oracle, but `@effected/cli` is boundary
tier and [R1](../conventions/dependency-policy.md) forbids an external runtime
dependency there. Probe P5 measured whether a small own implementation could
agree with it.[^p2-probe-display-width]

## Decision

The package carries about 16 lines of its own in `internal/displayWidth.ts`:
`Intl.Segmenter` for graphemes, `\p{Emoji_Presentation}` and `\p{RGI_Emoji}`
for emoji, and a hand-kept East Asian Width range table, with an ANSI stripper
for CSI and OSC-8 sequences. A differential test, the only file importing
`string-width`, compares it against the oracle on the curated strings, a sweep
of code points and a seeded fuzz. `string-width` is a `devDependency`.

### Known divergences

The implementation matches `string-width` on every code point real text
contains, with two documented exceptions, both pinned in the differential
test:

- a lone regional indicator, which the oracle counts as one column and this
  counts as two;
- a bare combining mark glued after an emoji or flag grapheme, which the
  oracle folds into one column and this counts as two.

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
data. If exact parity with a third-party renderer ever matters more than the
dependency edge, the answer is to declare `string-width`, which is a new
Decision.

[^interactive-cli-kit-design]: `../../docs/superpowers/specs/2026-09-30-interactive-cli-kit-design.md`

[^p2-probe-display-width]: probe P5 of the P2 plan, run against string-width 8.3.0 on Node 26
