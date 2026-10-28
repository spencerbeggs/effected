# @effected/source

Source-text positions as plain values. `LineIndex` is a line table built once over a text: offset to zero-based `{ line, character }` and back, in UTF-16 code units, the LSP default. Beside it sit the structural shapes the kit's format packages already share: `SourcePosition`, `SourceRange`, `SourceSpan` (an LSP `Range`), `SourceLocation` and `SourceDiagnostic`. Pure tier with no dependency and no peer, not even `effect`, so any package at any tier, and any LSP server, CLI or lint host, may take it as a regular dependency.

The shapes are interfaces, not Schema classes. `YamlDiagnostic`, `TomlDiagnostic` and `MarkdownDiagnostic` satisfy `SourceDiagnostic` as they stand, `JsoncParseErrorDetail` and `YamlToken` satisfy `SourceLocation` (the jsonc detail carries no `message`), and `JsoncRange`, `YamlRange`, `TomlRange` and `MarkdownRange` satisfy `SourceRange`. Each package keeps its own classes and error types.

## Import

```ts
import { LineIndex } from "@effected/source";
import type { LineBreaks, SourceDiagnostic, SourceIndex, SourceLocation, SourcePosition, SourceRange, SourceSpan } from "@effected/source";
```

## Core API

- **`LineIndex.make(text, { lineBreaks? })`**: one forward scan, `O(n)`; every query is a binary search, so build one per text and reuse it.
- **`lineCount`**, **`lineAt(offset)`**, **`lineStart(line)`**, **`lineEnd(line)`** (excluding the terminator), **`lineText(line)`**.
- **`positionAt(offset)`** and **`offsetAt(position)`**: the conversion both ways.
- **`spanOf(range)`** (offsets to an LSP `Range`), **`rangeOf(span)`** (back), **`locationOf(range)`** (the range plus its start position, the shape a diagnostic carries).
- **`SourceIndex`**: the public surface of `LineIndex` as a structural interface, which `LineIndex` implements. Name it, never the class, in any signature that takes or returns an index: the class has `private` members, so TypeScript compares it nominally and a `LineIndex` from a second installed copy fails with TS2345. `YamlDiagnostic.fromRaw`, `MarkdownDiagnostic.fromRaw` and `MarkdownDocument.lineIndex` use it.
- **`lineBreaks`**: `"lsp"` (default) ends a line at `\n`, `\r\n` or a bare `\r`; `"lf"` at `\n` only (a `\r\n` stays one terminator, a bare `\r` is text); `"unicode"` adds U+2028 and U+2029.

## Usage

```ts
import { LineIndex } from "@effected/source";

const index = LineIndex.make("name: kit\r\nversion: 1\n");

console.log(index.positionAt(11)); // { line: 1, character: 0 }
console.log(index.offsetAt({ line: 1, character: 9 })); // 20
console.log(index.spanOf({ offset: 11, length: 7 }));
// { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } }
console.log(index.lineCount); // 3: the text ends in a terminator, so its last line is empty
```

## Gotchas

- **Out-of-range input clamps, as `vscode-languageserver-textdocument` does**: an offset below `0` or past the end reads as the nearest end; an offset inside a `\r\n` (at its `\n`) reads as the end of its line; a `character` past its line reads as the line's end, before the terminator; a `line` past the last reads as `text.length`.
- **A non-integer throws `RangeError`** (`NaN`, `1.5`, `Infinity`): clamping `NaN` would answer "line 0" for a value that was never a position.
- **Positions are zero-based.** Add 1 to both fields for a person (`line + 1:character + 1`); a unist/mdast `Point` is `{ line: positionAt(o).line + 1, column: positionAt(o).character + 1 }`.
- **`character` counts UTF-16 code units**, so an emoji is two, and a position can land between the halves of a surrogate pair. There is no code-point or UTF-8 encoding option: every LSP client accepts UTF-16.
- **`"unicode"` exists to reproduce `@effected/jsonc`'s and `@effected/yaml`'s diagnostic positions.** An LSP client does not count U+2028 or U+2029 as line breaks, so positions after one disagree with the editor's.
