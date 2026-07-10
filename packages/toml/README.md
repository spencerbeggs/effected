# @effected/toml

[![npm](https://img.shields.io/npm/v/@effected%2Ftoml?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/toml)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Zero-dependency TOML 1.0.0 parsing, editing and formatting expressed as Effect schemas and pure functions. Parse TOML into plain values or a byte-exact linear CST, compute comment-preserving edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema.

## Why @effected/toml

TOML is the config format behind `Cargo.toml`, `pyproject.toml` and a large share of the Rust and Python toolchains. Most JavaScript TOML libraries either round-trip through a plain-object model — losing every comment and blank line the moment you write the file back out — or vendor a parser never built for editing in place. `@effected/toml` is a from-scratch engine: a lossless linear CST whose expression spans tile the source byte-exact, so `TomlDocument.parse(text).stringify() === text` for any valid document, plus a semantic pass that resolves the full 1.0.0 table/key model on top of it. Edits are computed as byte-minimal splices against that CST, so formatting and path-based modification preserve every comment and every byte you did not touch. All fallible entry points carry a typed error built from `TomlDiagnostic` — never a collapsed string reason or an unhandled defect, even on hostile input.

## Install

```bash
npm install @effected/toml effect
```

```bash
pnpm add @effected/toml effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

## Quick start

Decode TOML straight into a validated domain value by composing your schema with `Toml.schema`, or reach for the pre-bound `Toml.TomlFromString` codec directly:

```ts
import { Toml } from "@effected/toml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ name: Schema.String, port: Schema.Number });
const ConfigFromToml = Toml.schema(Config);

const program = Effect.gen(function* () {
  const config = yield* Schema.decodeUnknownEffect(ConfigFromToml)(`
    name = "api"
    port = 3000
  `);
  const raw = yield* Schema.decodeUnknownEffect(Toml.TomlFromString)('name = "Alice"\nage = 30');
  return { config, raw };
});

Effect.runPromise(program).then(console.log);
// { config: { name: "api", port: 3000 }, raw: { name: "Alice", age: 30 } }
```

Edit a document in place without disturbing its comments:

```ts
import { TomlFormat } from "@effected/toml";
import { Effect } from "effect";

const source = `# server config
name = "api"
port = 3000 # dev default
`;

const program = Effect.gen(function* () {
  return yield* TomlFormat.modifyToString(source, ["port"], 8080);
});

Effect.runPromise(program).then(console.log);
// # server config
// name = "api"
// port = 8080 # dev default
```

## Features

- `Toml.parse` / `Toml.stringify` — value-level parse and canonical stringify, both carrying typed `TomlParseError` / `TomlStringifyError` channels, including nesting-depth guards on adversarial input.
- `Toml.fromString` / `Toml.TomlFromString` / `Toml.schema` — string→domain schema factories that decode TOML directly into a validated Effect `Schema` value.
- `TomlDocument` — the lossless document: `parse`/`schema`/`toValue`/`stringify`, backed by the linear CST whose expression spans reconstruct the source byte-exact.
- `TomlEdit` / `TomlRange` (+ `applyAll`) — the non-mutating text-edit vocabulary shared by the formatter and modifier, parity-identical to `@effected/jsonc`'s and `@effected/yaml`'s edit shapes.
- `TomlFormat` — `format`/`formatToString` compute conservative, comment-preserving formatting edits; `modify`/`modifyToString` compute the edits to replace, delete or insert a value at a path, resolved through the document's semantic view.
- `TomlVisitor` — walk a parsed document as a `Stream` of visitor events.
- `TomlDiagnostic` — a structured diagnostic (`code`, `message`, `offset`/`length`, `line`/`character`) every typed error carries, across five staged error-code unions.
- The four `TomlDateTime` classes (`TomlLocalDate`, `TomlLocalTime`, `TomlLocalDateTime`, `TomlOffsetDateTime`) — TOML's date-time types as calendar-validated Effect `Schema.Class` value objects.

## Testing

Two devDependency-only test oracles keep the engine honest without becoming runtime dependencies: `smol-toml` (exact-pinned, imported only under `__test__/oracle.property.test.ts`) backs a differential property suite, and the vendored [toml-test](https://github.com/toml-lang/toml-test) 1.0.0 compliance corpus (`__test__/fixtures/toml-test/`) is run to 100% pass with no skip list.

## License

[MIT](LICENSE)
