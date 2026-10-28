# @effected/source

[![npm](https://img.shields.io/npm/v/@effected%2Fsource?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/source)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Source-text positions as plain values: a line index that turns an offset into an LSP-style zero-based line and character and back, and the range, position and diagnostic shapes the `@effected` format packages share. No service, no platform, no `effect`, and no dependency at all.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, still in `0.x`
> development. It has no dependencies, not even `effect`.
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/source

A parser reports where something went wrong as an offset into the text. An editor, a language server and a person all want a line and a column. The conversion looks like a five-line loop, and that loop is easy to get subtly wrong: which characters end a line, what an offset between the `\r` and `\n` of a Windows line ending means, and whether a column counts code units or characters. This package is the conversion written once, by the rules the Language Server Protocol uses.

## Install

```bash
npm install @effected/source
```

```bash
pnpm add @effected/source
```

Requires Node.js >=24.11.0. No dependencies and no peers. ESM-only: import it from an ES module.

## Usage

```ts
import { LineIndex } from "@effected/source";

const index = LineIndex.make("name: kit\r\nversion: 1\n");

index.positionAt(11);
// { line: 1, character: 0 }

index.offsetAt({ line: 1, character: 9 });
// 20

index.spanOf({ offset: 11, length: 7 });
// { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } }
```

- **`LineIndex.make(text, options?)`** builds the line table once; every query after that is a binary search. `positionAt` and `offsetAt` convert both ways, `lineCount`, `lineAt`, `lineStart`, `lineEnd` and `lineText` describe the lines, and `spanOf`, `rangeOf` and `locationOf` convert ranges.
- **Positions are zero-based** and `character` counts UTF-16 code units, LSP's default. Add 1 to both for a person.
- **Lines end at `\n`, `\r\n` or a bare `\r`** by default. `lineBreaks: "lf"` ends them at `\n` only, and `lineBreaks: "unicode"` also at U+2028 and U+2029.
- **Out-of-range input clamps** to the nearest valid position, as `vscode-languageserver-textdocument` does. A value that is not an integer throws a `RangeError`.
- **`SourcePosition`, `SourceRange`, `SourceSpan`, `SourceLocation` and `SourceDiagnostic`** are structural interfaces, so the diagnostics and ranges of `@effected/jsonc`, `@effected/yaml`, `@effected/toml` and `@effected/markdown` can be read through them as they are.

## Documentation

The guide and the API reference are at [effected.spencerbeg.gs/source](https://effected.spencerbeg.gs/source).

## License

[MIT](LICENSE)
