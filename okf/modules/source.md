---
type: Module
title: "@effected/source"
description: "Source-text positions as plain values: a LineIndex from offsets to LSP-style zero-based line and character and back, and the structural range, position and diagnostic shapes the kit's format packages share."
status: draft
kind: package
resource: ../../packages/source
tags:
  - architecture
  - bundle
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-28T00:00:00Z
  - id: issue-1126
    resource: https://github.com/spencerbeggs/effected/issues/1126
    title: "markdown/yaml: export the offset-to-line/character conversion"
  - id: issue-1127
    resource: https://github.com/spencerbeggs/effected/issues/1127
    title: "lsp: file: URI <-> path helpers (LspUri)"
  - id: issue-1030
    resource: https://github.com/spencerbeggs/effected/issues/1030
    title: "markdown: a markdownlint-compatible lint shape"
  - id: lsp-position
    resource: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#position
    title: "LSP 3.17 Position: zero-based, UTF-16 by default, line endings \\n, \\r\\n and \\r"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-28T19:33:06Z
integrity:
  generated:
    body: 15bfb293ddba66cd
---

# @effected/source

`@effected/source` is source-text positions as plain values. It exists because
four format packages each hand-rolled the same contract: `jsonc`, `yaml`,
`toml` and `markdown` all carry a private loop turning a UTF-16 offset into a
zero-based `{ line, character }`, and all four give their diagnostics the same
`{ code, message, offset, length, line, character }` core and their ranges the
same `{ offset, length }` shape. Two consumer requests asked for the
conversion to be exported ([#1126][issue-1126], okfit's language server and
CLI annotations), and the LSP position helpers ([#1127][issue-1127]) and the
planned markdownlint-compatible lint shape ([#1030][issue-1030]) need lines
with positions too. The owner approved the package on 2026-10-28.[^owner]

## Tier and dependencies

**Pure, with no dependency at all**: no `effect` (not even a peer), no
`node:` import, no service, no `@effected/*` edge, `"sideEffects": false`.
Nothing in it needs Schema: positions are numbers, and the conversion is a
total function over a string. Its adopters take it as a **regular
dependency**, never a peer, which the peer discipline allows only because it
carries no shared-instance contract. That is a design rule here, not a
convenience:

- The shapes are **structural interfaces**, never Schema classes compared by
  identity. Two installed copies of this package must never disagree about
  what a position is, and a class identity would make them disagree.
- `LineIndex` is a class, but nothing checks `instanceof LineIndex` and every
  value it returns is a plain record, so two copies interoperate at runtime.
- **At the type level the class is nominal**, because it has `private`
  members: a `LineIndex` from one installed copy is not assignable to another
  copy's `LineIndex` (TS2345, reproduced with tsc 7.1). So every signature
  that takes or returns an index, in this package and in its adopters, names
  the structural **`SourceIndex`** interface (its public methods and readonly
  properties only), which `LineIndex` implements. `YamlDiagnostic.fromRaw`,
  `MarkdownDiagnostic.fromRaw` and `MarkdownDocument.lineIndex` take or return
  `SourceIndex`; a type-level test in each package passes a second-copy
  stand-in with its own `private` members. `LineIndex` is the only class in
  the surface and the only one with `private` or `#private` members.

This is not the rejected shared errors package
(`okf/decisions/no-shared-errors-package.md`). It ships no error class, no
base class and no code union: each format package keeps its own diagnostic
class, its own `code` literals and its own tagged errors as part of its own
API. `SourceDiagnostic` only names the shape they already share, so a consumer
(an LSP server, a CLI printing annotations, a lint host) is written once.

## The surface

| Module | Exports | Concept |
| --- | --- | --- |
| `LineIndex` | `LineIndex`, `LineBreaks`, `LineIndexOptions` | A line table built once over a text by one forward scan; every query is a binary search. `positionAt` / `offsetAt` convert both ways; `lineCount`, `lineAt`, `lineStart`, `lineEnd` (excluding the terminator) and `lineText`; `spanOf` / `rangeOf` between offsets and an LSP `Range`; `locationOf` for the shape a diagnostic carries. |
| `SourceIndex` | `SourceIndex` | `LineIndex`'s public surface as a structural interface: the type to name in a signature that takes or returns an index, so two installed copies interoperate. |
| `SourcePosition` | `SourcePosition` | `{ line, character }`, zero-based, `character` in UTF-16 code units: an LSP `Position`. |
| `SourceRange` | `SourceRange` | `{ offset, length }` in UTF-16 code units. |
| `SourceSpan` | `SourceSpan` | `{ start, end }` positions, `end` exclusive: an LSP `Range`. |
| `SourceDiagnostic` | `SourceLocation`, `SourceDiagnostic` | The positional core (`SourceRange` plus the start's `SourcePosition`), and that core with `code` and `message`. |

`LineIndex` follows the kit's class shape: a private constructor and a static
`make`. There are no statics duplicating an instance method (no
`LineIndex.positionAt(text, offset)`), so a one-shot conversion is
`LineIndex.make(text).positionAt(offset)`; building the table costs the same
single scan the hand-rolled loops cost.

## Rulings

**Base: zero-based.** Every package's structured `line` and `character` is
zero-based today (jsonc, yaml and toml say "LSP convention" in their TSDoc),
and LSP is zero-based. A person reads `line + 1:character + 1`, which is what
the packages' error `message`s already print. markdown's mdast `Point` is the
one one-based surface; it maps through `lineAt` and `lineStart`, not `positionAt` + 1 (below).

**Encoding: UTF-16 code units, no code-point option.** LSP's default
encoding, what a JavaScript string index is, and what every kit format
package's offsets already are. LSP 3.17 lets a server negotiate `utf-32` or
`utf-8`, but every client must accept `utf-16`, so a kit server never needs
another. An encoding option would be additive later; adding it now would be
a surface no adopter uses. A position can name the low half of a surrogate
pair, as LSP allows.

**Line terminators: LSP's `\n`, `\r\n` and bare `\r` by default**, with two
other rules (`LineBreaks`) so every existing producer can be reproduced:
`"lf"` (a line ends at `\n` only; `\r\n` stays one terminator; a bare `\r`
is text) and `"unicode"` (`"lsp"` plus U+2028 and U+2029).[^lsp-position]

**Clamping follows `vscode-languageserver-textdocument`**, the `TextDocument`
most LSP servers already use, so a kit server agrees with it on every edge:

- an offset below `0` reads as `0`, and one past the end as `text.length`;
- an offset **inside a `\r\n`** (at its `\n`) reads as the end of its line:
  LSP cannot name the middle of a terminator, and this is the case where all
  four hand-rolled loops answer `character: -1` (see the bug below);
- in `offsetAt`, a `character` past its line clamps to the line's end before
  its terminator, a negative one to the line's start, a `line` below `0` to
  offset `0`, and a `line` past the last to `text.length`;
- `lineStart` / `lineEnd` / `lineText` clamp the line into `[0, lineCount - 1]`.

**A non-integer argument throws `RangeError`**, as a programmer error rather
than out-of-range input: `NaN`, `1.5` and an infinity of either sign. Clamping `NaN` would
silently answer "line 0", the bare-`<`-guard failure the input-hardening
convention names. `spanOf` and `locationOf` both reject a `length` that is
not a non-negative integer, through one shared guard (`locationOf` once
accepted `NaN` and negatives, passing them through to the location
unchanged), and `rangeOf` rejects a span whose end precedes its start.

**Every text has at least one line.** The empty text has one empty line, and a
text ending in a terminator has an empty last line after it (`"a\n"` has two
lines), as an editor shows it and as markdown's AST already places its root's
end point.

## What each package computes today

Measured by a scratchpad probe against the built packages, then by a
differential run of every string of up to five characters over
`{a, \n, \r, U+2028, U+2029, U+1F600}` at every offset.

| Producer | Base | Line breaks | Offset at the `\n` of a `\r\n` | Out-of-range offset | `LineIndex` mapping |
| --- | --- | --- | --- | --- | --- |
| `JsoncParseErrorDetail` (`Jsonc.ts` `lineChar`) | 0 | `\n`, `\r\n`, `\r`, U+2028, U+2029 | next line, `character: -1` | unclamped (`character` past the line, or negative) | `{ lineBreaks: "unicode" }` then `positionAt` |
| `YamlDiagnostic` (`YamlDiagnostic.ts` `lineChar`) | 0 | `\n`, `\r\n`, `\r`, U+2028, U+2029 | next line, `-1` | unclamped | `{ lineBreaks: "unicode" }` then `positionAt` |
| `YamlToken` (`YamlToken.ts` `promoteAll`) | 0 | `\n` only (`\r` of a `\r\n` stays on its line; bare `\r` is not a break) | not reached: no token starts there | n/a | `{ lineBreaks: "lf" }` then `positionAt` |
| yaml lint lines (`YamlLint.ts` `buildLines`) | 0 | `\n` only; a `\r` before `\n` is stripped from the line's text | n/a | n/a | `"lf"`: `lineText(n)` for `n < lineCount - 1` when the text ends in `\n`, else every line; the empty text has none |
| `TomlDiagnostic` (`TomlDiagnostic.ts` `lineChar`) | 0 | `\n`, `\r\n`, `\r` | next line, `-1` | unclamped | `positionAt` (default `"lsp"`) |
| `MarkdownDiagnostic` (`MarkdownDiagnostic.ts` `lineChar`) | 0 | `\n`, `\r\n`, `\r` | next line, `-1` | unclamped | `positionAt` (default `"lsp"`) |
| markdown mdast `Point` (now `LineIndex`; was `internal/lineIndex.ts`, fed the preprocessor's line table) | 1 (`line`, `column`) | `\n`, `\r\n`, `\r`, plus a final empty line after a trailing `\n` | reached: a node can end at the `\n` of a `\r\n` (the empty list item in `*\r\na` ends at offset 2, line 1, column 3) | clamped | `"lsp"`: `line = lineAt(o) + 1`, `column = o - lineStart(lineAt(o)) + 1`, as `vfile-location` counts. Not `positionAt` + 1, which clamps that offset to the line's end and changes 130 parsed trees in the differential |

The differential found **zero** disagreements under those mappings except at
one offset class, an offset at the `\n` of a `\r\n`, where all four
diagnostic loops disagree with `LineIndex` in every case (985 of 985 per
package). Out-of-range offsets were not in the corpus: no engine emits one,
and `LineIndex` clamps them where the loops do not.

## Findings for the adoption wave

- **Bug, all four diagnostic loops: `character: -1` at the `\n` of a
  `\r\n`.** The loop advances past the pair and then subtracts. Reproduced on
  `YamlDiagnostic.fromRaw`, `TomlDiagnostic.fromRaw` and
  `MarkdownDiagnostic.fromRaw` with `"a\r\nb"` at offset 2 (`1:-1`); jsonc's
  loop is the same code, but jsonc's scanner never emits that offset (zero in
  over 2 million generated parse errors), so there it is reachable only through
  the internal materializer. okfit's own `lineCharacter` (the #1126 consumer)
  carries the same bug. Adopting `LineIndex` fixes it, and changes output
  only at that offset class.
- **Bug, `@effected/yaml`: diagnostics count U+2028 and U+2029 as line
  breaks.** YAML 1.2 does not (only 1.1 did), yaml's own lexer and
  `YamlToken` positions do not, and an LSP client does not: in
  `"a: 1\u2028b: 2"` the token at `b` is `0:6` while a diagnostic there is
  `1:0`. The comment claims parity with jsonc. Recommend yaml adopt the
  default `"lsp"` rule, an observable change after a separator.
- **Choice, probably a bug for LSP consumers: `@effected/jsonc` counts
  U+2028 and U+2029** because its scanner, inherited from VS Code's
  `jsonc-parser`, treats them as line breaks. Positions after one disagree
  with any LSP client. `"unicode"` reproduces it; the ruling is jsonc's.
- **Resolved, `@effected/yaml`: a bare `\r` is a line break everywhere.**
  YAML 1.2 counts a bare `\r` as a line break (`b-break`). yaml's composer
  once did not, so moving `YamlToken` positions and lint lines to `"lsp"`
  alone put lint fixes inside scalars and changed parsed values; they were
  held on `"lf"` until the composer was fixed. The composer now breaks at a
  bare `\r` like `\n`, so tokens, lint lines and diagnostics all use
  `"lsp"`, and a lint-fix property holds every rule's fix to the parsed
  value.
- **Not a bug: markdown's two conversions.** The diagnostic loop and the AST
  index agree on line breaks; one is zero-based and one-based by design.
- `JsoncParseErrorDetail` has no `message` field, so it satisfies
  `SourceLocation` and not `SourceDiagnostic`.

## Testing

`__test__/LineIndex.test.ts` pins every edge by example (empty text, offset at
the end of the text, the `\r\n` split, a surrogate pair, each clamping rule,
each `RangeError`) and then checks `LineIndex` against an **independent
oracle**: a regular-expression splitter sharing no code with it, over every
string of up to six characters drawn from `{a, \n, \r, U+2028, \uD83D,
\uDE00}`, every offset, and all three rules, including the
position-to-offset round trip. `__test__/entrypoints.test.ts` pins the export
list (`LineIndex` is the only runtime value), that `src/` imports nothing but
itself, and that the manifest declares no dependency or peer.

[issue-1126]: https://github.com/spencerbeggs/effected/issues/1126
[issue-1127]: https://github.com/spencerbeggs/effected/issues/1127
[issue-1030]: https://github.com/spencerbeggs/effected/issues/1030

[^owner]: The owner approved a new pure `@effected/source` package on
    2026-10-28, with `jsonc`, `yaml`, `toml`, `markdown` and `lsp` adopting it
    in a later wave.
[^lsp-position]: LSP 3.17 `Position`: lines and characters are zero-based,
    `character` is in the negotiated encoding with UTF-16 the default, and the
    line endings are `\n`, `\r\n` and `\r`.
