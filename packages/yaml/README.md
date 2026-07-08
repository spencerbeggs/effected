# @effected/yaml

[![npm](https://img.shields.io/npm/v/@effected%2Fyaml?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Zero-dependency YAML parsing, editing and formatting expressed as Effect schemas and pure functions. Parse a single document or a multi-document stream into plain values or an offset-preserving AST, resolve anchors and aliases, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema.

## Why @effected/yaml

YAML is the config format behind CI pipelines, Kubernetes manifests and much of the JavaScript toolchain. A naive parse then re-serialize round-trip throws away every comment and the original layout. `@effected/yaml` parses with error recovery, aggregating every diagnostic into one `YamlParseError` carrying structured positions instead of failing on the first, computes byte-minimal edits that preserve every comment and byte you did not touch, and decodes YAML straight into a validated Effect `Schema` — all as pure functions with no IO.

## Install

```bash
npm install @effected/yaml effect
```

```bash
pnpm add @effected/yaml effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

## Quick start

Decode YAML straight into a validated domain value by composing your schema with `Yaml.schema`:

```ts
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromYaml = Yaml.schema(Config);

const program = Effect.gen(function* () {
  const config = yield* Schema.decodeUnknownEffect(ConfigFromYaml)("port: 3000 # dev server");
  return config;
});

Effect.runPromise(program).then(console.log);
// { port: 3000 }
```

## Features

- `Yaml.parse` / `Yaml.parseAll` — error-recovery parsing of a single document or a multi-document stream into plain values, resolving anchors and aliases and aggregating every diagnostic into one `YamlParseError` rather than failing on the first; a runaway alias expansion (the YAML "billion laughs" bomb) is bounded and surfaced as a typed `YamlParseError` carrying an `AliasCountExceeded` diagnostic rather than exhausting the heap.
- `Yaml.stringify` — serialize a plain value back to YAML, failing typed with `YamlStringifyError` on circular references, or on excessively deep nesting (a `NestingDepthExceeded` diagnostic) rather than overflowing the stack.
- `Yaml.stripComments` — quote-aware, offset-preserving comment removal that keeps line numbers stable, or every byte offset stable when given a replacement character.
- `Yaml.equals` / `Yaml.equalsValue` — semantic equality that ignores comments, whitespace, formatting and mapping key order while keeping sequence order significant.
- `Yaml.schema` / `Yaml.fromString` / `Yaml.YamlFromString` / `Yaml.allFromString` — string→domain schema factories that decode YAML, a single document or a `---`-separated stream, directly into a validated Effect `Schema` value.
- `YamlNode` — an offset-preserving AST (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`) with `find`, `findAtOffset`, `pathOf` and `toValue` for locating and reading nodes by position or path.
- `YamlEdit` / `YamlFormat` — compute byte-minimal edit arrays for formatting and path-based modification, so callers apply the smallest possible diff instead of re-serializing the whole document.
- `YamlVisitor` — walk a parsed document as a `Stream` of a tagged-enum event union, with `Stream.take` early termination on large inputs.
- `YamlParseError` / `YamlStringifyError` / `YamlModificationError` — tagged errors carrying structured, positional `YamlDiagnostic` arrays rather than opaque messages.

## License

[MIT](LICENSE)
