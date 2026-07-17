# @effected/yaml

[![npm](https://img.shields.io/npm/v/@effected%2Fyaml?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Zero-dependency YAML 1.2 parsing, editing and formatting expressed as Effect schemas and pure functions. Parse a single document or a multi-document stream into plain values or an offset-preserving AST, resolve anchors and aliases, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream` and decode straight into a validated domain schema.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/yaml

YAML is where untrusted text meets production systems: CI pipeline definitions, Kubernetes manifests and config files that arrive from a pull request, an API payload or a user's home directory. The format is also large enough that a parser has real attack surface. An anchor that references an anchor that references an anchor — the "billion laughs" bomb — is a few hundred bytes of YAML that expands into gigabytes of nodes, and a deeply nested flow collection is a few kilobytes that overflows a recursive-descent parser's stack.

This package treats that as a first-class requirement rather than a footnote. An alias-expansion budget bounds the number of materialized nodes, a depth cap bounds collection nesting on both the parse and the stringify side, and both fire into the typed error channel. Hostile input produces a `YamlParseError` carrying structured `YamlDiagnostic` values with codes and positions; it never produces a `RangeError`, an unhandled defect or an exhausted heap.

The rest follows from the same discipline. Parsing recovers from errors and aggregates every diagnostic into one failure rather than throwing on the first. Modifications are computed as edits against the original bytes, so comments and layout survive a change. Everything is a pure function or a schema: no IO, no services and no runtime dependency other than `effect` — the lexer, CST parser, composer and stringifier are vendored into the package with attribution rather than taken as a dependency. It is the largest package in the repo, and it earns that by owning its engine.

## Install

```bash
npm install @effected/yaml effect
```

```bash
pnpm add @effected/yaml effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no other runtime dependencies.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Quick start

Compose your schema with `Yaml.schema` to decode YAML straight into a validated domain value:

```ts
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromYaml = Yaml.schema(Config);

const program = Effect.gen(function* () {
  return yield* Schema.decodeUnknownEffect(ConfigFromYaml)("port: 3000 # dev server");
});

Effect.runPromise(program).then(console.log);
// { port: 3000 }
```

`Yaml.stringify` goes the other way, failing typed on circular references rather than throwing:

```ts
import { Yaml } from "@effected/yaml";
import { Effect } from "effect";

Effect.runPromise(Yaml.stringify({ port: 3000, hosts: ["a", "b"] })).then(console.log);
// port: 3000
// hosts:
// - a
// - b
```

## Hostile input fails typed

An alias bomb — nested anchors whose expansion multiplies at every level — is bounded by an expansion budget and surfaces as a `YamlParseError`, not as an out-of-memory kill:

```ts
import { Yaml } from "@effected/yaml";
import { Effect } from "effect";

const bomb = [
  "a: &a [x,x,x,x,x,x,x,x,x]",
  "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]",
  // ...further levels, each multiplying the one before
  "z: [*g,*g,*g,*g,*g,*g,*g,*g,*g]",
].join("\n");

Effect.runPromise(Effect.result(Yaml.parse(bomb))).then(console.log);
// Failure with YamlParseError, whose `diagnostics` carry:
// { code: "AliasCountExceeded", message: "Alias expansion exceeded budget of ... nodes" }
```

Collection nesting past the depth cap behaves the same way, yielding a `NestingDepthExceeded` diagnostic instead of a stack overflow, and `Yaml.stringify` caps the mirror-image recursion when encoding a value back to text. The guarantee is the same everywhere: every fallible entry point carries a real error channel, and nothing reaches your process as a defect.

## Features

- `Yaml.parse` / `Yaml.parseAll` — error-recovery parsing of a single document or a `---`-separated stream into plain values, resolving anchors and aliases and aggregating every diagnostic into one `YamlParseError`.
- `Yaml.stringify` — serialize a plain value back to YAML, failing typed with `YamlStringifyError` on circular references or on excessively deep nesting.
- `Yaml.stripComments` — quote-aware comment removal that keeps line numbers stable, or every byte offset stable when given a replacement character.
- `Yaml.equals` / `Yaml.equalsValue` — semantic equality that ignores comments, whitespace, formatting and mapping key order while keeping sequence order significant.
- `Yaml.schema` / `Yaml.fromString` / `Yaml.YamlFromString` / `Yaml.allFromString` — string→domain schema factories that decode a single document or a whole stream into a validated Effect `Schema` value.
- `YamlNode` — an offset-preserving AST (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`) for locating and reading nodes by position or path.
- `YamlDocument` — the full parsed AST plus the recovered `errors` and `warnings` arrays, so a partially valid document is still inspectable.
- `YamlEdit` / `YamlFormat` — compute byte-minimal edit arrays for formatting and path-based modification, so a change preserves every comment and byte you did not touch.
- `YamlVisitor` — walk a parsed document as a `Stream` of a tagged-enum event union, with `Stream.take` early termination on large inputs.
- `YamlParseError` / `YamlStringifyError` / `YamlModificationError` — tagged errors carrying structured, positional `YamlDiagnostic` arrays rather than opaque messages.

## License

[MIT](LICENSE)
