# @effected/jsonc

[![npm](https://img.shields.io/npm/v/@effected%2Fjsonc?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/jsonc)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Zero-dependency JSONC parsing, editing and formatting expressed as Effect schemas and pure functions. Parse JSONC into plain values or an offset-preserving AST, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema.

## Why @effected/jsonc

JSONC — JSON with comments and trailing commas — is the config format behind `tsconfig.json`, VS Code settings and much of the JavaScript toolchain. A `JSON.parse` / `JSON.stringify` round-trip throws away every comment and the original formatting. `@effected/jsonc` parses with error recovery, computes byte-minimal edits that preserve every comment and byte you did not touch, and decodes JSONC straight into a validated Effect `Schema` — all as pure functions (no IO) with a single aggregate parse error instead of a fail-on-first-error surprise.

## Install

```bash
npm install @effected/jsonc effect
```

```bash
pnpm add @effected/jsonc effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

## Quick start

Decode JSONC straight into a validated domain value by composing your schema with `Jsonc.schema`:

```ts
import { Jsonc } from "@effected/jsonc";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromJsonc = Jsonc.schema(Config);

const program = Effect.gen(function* () {
  const config = yield* Schema.decodeUnknownEffect(ConfigFromJsonc)(`{
    "port": 3000 // dev server
  }`);
  return config;
});

Effect.runPromise(program).then(console.log);
// { port: 3000 }
```

## Features

- `Jsonc.parse` / `Jsonc.parseTree` — error-recovery parsing to a plain value or an offset-preserving `JsoncNode` AST, aggregating every recovered error into one `JsoncParseError` rather than failing on the first.
- `Jsonc.stripComments` — pure, offset-preserving comment removal that yields valid JSON.
- `Jsonc.equals` / `Jsonc.equalsValue` — semantic equality that ignores comments, whitespace, formatting and key order.
- `Jsonc.schema` / `Jsonc.fromString` / `Jsonc.JsoncFromString` — string→domain schema factories that decode JSONC directly into a validated Effect `Schema` value.
- `JsoncFormatter` / `JsoncModifier` — compute byte-minimal `JsoncEdit` arrays for formatting and path-based modification, so callers apply the smallest possible diff instead of re-serializing the document.
- `JsoncVisitor` — walk a parsed document as a `Stream` of visitor events, with `Stream.take` early termination on large inputs.
- `JsoncParseError` / `JsoncModificationError` — tagged errors carrying structured, positional payloads rather than opaque messages.

## License

[MIT](LICENSE)
