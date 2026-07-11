# @effected/jsonc

[![npm](https://img.shields.io/npm/v/@effected%2Fjsonc?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/jsonc)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Zero-dependency JSONC parsing, editing and formatting expressed as Effect schemas and pure functions. Parse JSONC into plain values or an offset-preserving AST, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema.

## Why @effected/jsonc

JSONC is JSON with comments and trailing commas: the format behind `tsconfig.json`, VS Code settings and much of the JavaScript toolchain. Those files are written by humans, and humans leave comments in them. A `JSON.parse` then `JSON.stringify` round-trip destroys every one of them, so any tool that rewrites a `tsconfig.json` that way hands the user back a file they did not recognize.

This package treats the source text as the document. Modifications are computed as edits against the original bytes rather than re-serialized from a parsed object, so a change to one key leaves every comment, blank line and indentation choice untouched. Parsing recovers from errors and aggregates every diagnostic into one `JsoncParseError` carrying `code`, `offset`, `length`, `line` and `character` per error, instead of throwing on the first. And `Jsonc.schema` composes with a domain schema so a JSONC string decodes into a validated value in a single step.

Everything is a pure function or a schema. No IO, no services, and no runtime dependency other than `effect` itself: the scanner, parser and navigator are vendored into the package with attribution rather than pulled in as a dependency.

## Install

```bash
npm install @effected/jsonc effect
```

```bash
pnpm add @effected/jsonc effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

## Quick start

Compose your schema with `Jsonc.schema` to decode JSONC straight into a validated domain value:

```ts
import { Jsonc } from "@effected/jsonc";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromJsonc = Jsonc.schema(Config);

const program = Effect.gen(function* () {
  return yield* Schema.decodeUnknownEffect(ConfigFromJsonc)(`{
    // dev server
    "port": 3000
  }`);
});

Effect.runPromise(program).then(console.log);
// { port: 3000 }
```

Malformed input fails through the typed channel, never as a throw:

```ts
import { Jsonc } from "@effected/jsonc";
import { Effect } from "effect";

Effect.runPromise(Effect.result(Jsonc.parse('{ "a": }'))).then(console.log);
// Failure with JsoncParseError:
// "JSONC parse failed with 1 error: ValueExpected at 0:7"
// The `errors` field carries one JsoncParseErrorDetail per recovered error,
// each with code, offset, length, line and character.
```

## Editing without losing comments

`JsoncModifier.modify` returns a `JsoncEdit` array — offset, length and replacement content — that `JsoncEdit.applyAll` splices into the original text. Only the bytes covered by an edit change:

```ts
import { JsoncEdit, JsoncModifier } from "@effected/jsonc";
import { Effect } from "effect";

const source = `{
  // dev server
  "port": 3000
}`;

const program = Effect.gen(function* () {
  const edits = yield* JsoncModifier.modify(source, ["port"], 8080);
  return JsoncEdit.applyAll(source, edits);
});

Effect.runPromise(program).then(console.log);
// {
//   // dev server
//   "port": 8080
// }
```

`JsoncFormatter.format` produces the same kind of edit array for whitespace normalization, so a formatter pass is a diff rather than a rewrite.

## Comments and round-trips

There is no comment-preserving `stringify` in this package, and that is deliberate rather than an oversight. The encode direction of `Jsonc.schema`, `Jsonc.fromString` and `Jsonc.JsoncFromString` is `JSON.stringify` with a 2-space indent. **Comments do not survive a decode then encode round trip** — once a document has been reduced to a plain JavaScript value, the comments are already gone and no honest encoder can put them back.

Preserving comments requires the original source text, which is exactly what `JsoncModifier` and `JsoncFormatter` take. If you need to write a JSONC file back out with its comments intact, edit the text: parse for reading, and modify for writing.

## Features

- `Jsonc.parse` / `Jsonc.parseTree` — error-recovery parsing to a plain value or an offset-preserving `JsoncNode` AST, aggregating every recovered error into one `JsoncParseError` rather than failing on the first.
- `Jsonc.stripComments` — pure comment removal yielding valid JSON; pass a replacement character to keep every byte offset stable.
- `Jsonc.equals` / `Jsonc.equalsValue` — semantic equality that ignores comments, whitespace, formatting and object key order, while keeping array order significant.
- `Jsonc.schema` / `Jsonc.fromString` / `Jsonc.JsoncFromString` — string→domain schema factories that decode JSONC directly into a validated Effect `Schema` value.
- `JsoncFormatter` / `JsoncModifier` — compute byte-minimal `JsoncEdit` arrays for formatting and path-based modification, so callers apply the smallest possible diff instead of re-serializing the document.
- `JsoncVisitor` — walk a parsed document as a `Stream` of visitor events, with `Stream.take` early termination on large inputs.
- `JsoncParseError` / `JsoncModificationError` — tagged errors carrying structured, positional payloads rather than opaque messages. Hostile input (deep nesting, unterminated literals) fails through the error channel, never as a stack overflow.

## License

[MIT](LICENSE)
