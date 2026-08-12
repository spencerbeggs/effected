# @effected/yaml

[![npm](https://img.shields.io/npm/v/@effected%2Fyaml?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/yaml)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Zero-dependency YAML 1.2 parsing, editing, formatting and linting expressed as Effect schemas and pure functions. Parse a single document or a multi-document stream into plain values or an offset-preserving AST, resolve anchors and aliases, read and preserve per-node comments, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream` of AST events or positioned tokens, lint it against a rule catalog with surgical autofix, and decode straight into a validated domain schema.

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

Both directions have a synchronous counterpart that returns a `Result` for callers that cannot await an Effect, a `vitest.config.ts` being the motivating case. `Yaml.parse` is defined in terms of `Yaml.parseResult`, so the two forms cannot disagree about what a document means:

```ts
import { Yaml } from "@effected/yaml";
import { Result } from "effect";

const result = Yaml.parseResult("port: 3000 # dev server");
console.log(Result.isSuccess(result) ? result.success : result.failure);
// { port: 3000 }
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

## Comments survive an edit

A YAML file a human maintains is mostly explanation, and the explanation is the part a round-trip usually loses. `YamlFormat` computes its edits against the original bytes, so changing a value rewrites the value and leaves the header block, the trailing `# LTS`, the blank line and the indentation where they were. Setting `preserveComments: false` is how you ask for the other behavior:

```ts
import { YamlFormat, YamlFormattingOptions } from "@effected/yaml";

const source = 'node: "20.11.0" # LTS\n\n# why the port\nport: 3000\n';

console.log(YamlFormat.formatToString(source));
// node: "20.11.0" # LTS
//
// # why the port
// port: 3000

console.log(YamlFormat.formatToString(source, undefined, YamlFormattingOptions.make({ preserveComments: false })));
// node: "20.11.0"
// port: 3000
```

Comments are readable as data too. `YamlScalar`, `YamlMap`, `YamlSeq` and `YamlPair` each carry `commentBefore` (the own-line block above the node), `comment` (strictly the trailing comment on the node's own line) and `spaceBefore` (a blank line came first); `YamlDocument` adds `commentAfter` for a trailing block, and `YamlVisitor` tags every `Comment` event with `placement: "leading" | "trailing"`.

## Lint and autofix

`YamlLint.run` checks a string against a rule catalog and returns positioned diagnostics; `YamlLint.fix` applies the fixes that can be expressed as surgical edits and returns the fixed text. Both are pure and synchronous. This is the lint engine, not a runner — no file discovery, no config-file loading, nothing written to disk:

```ts
import { YamlLint, YamlLintConfig } from "@effected/yaml";
import { Result } from "effect";

const source = "# pinned\nname:  demo   \nport: yes\n";

for (const d of YamlLint.run(source, YamlLint.builtins, YamlLintConfig.default)) {
  console.log(`${d.line}:${d.character} ${d.severity} ${d.rule} ${d.message}`);
}
// 1:5 error colon-spacing Too many spaces after ":" (2 > 1)
// 1:11 error trailing-spaces Trailing whitespace
// 2:6 error truthy Truthy value "yes" is not in the allowed spellings

const fixed = YamlLint.fix(source, YamlLint.builtins, YamlLintConfig.default);
console.log(Result.isSuccess(fixed) ? fixed.success : "fatal parse error — not safely fixable");
// # pinned
// name: demo
// port: "yes"
```

Positions are zero-based throughout, so the first finding above sits on the second line of the source. Fixes route through `YamlEdit.applyAll` rather than a reformat, so an autofix cannot move a comment it was not asked to touch, and a rule whose repair would need reflowing the document ships without a fix at all. `YamlLintConfig.default` and `YamlLintConfig.relaxed` are the presets; compose your own by spreading a preset's `rules` into `YamlLintConfig.make`. Config validation is rule-aware for the built-in catalog — a misspelled option key on a built-in rule or an attempt to switch off the always-on `parse-validity` rule fails schema validation instead of being quietly ignored — while an unknown (custom) rule id passes through with its options treated as opaque, left for the custom rule itself to validate. Custom rules are plain array concatenation — `YamlLint.run(text, [...YamlLint.builtins, myRule], config)` — and configuring `myRule` in that config works precisely because of the pass-through.

## Migrating from Prettier

`YamlFormat.formatToString(text, undefined, options)` replaces a `prettier --write` over YAML files. The option mapping:

| Prettier | `YamlFormattingOptions` |
| --- | --- |
| `tabWidth` | `indent` |
| `singleQuote` | `quoteStyle: "single" \| "double"` |
| indented block sequences (always on) | `indentSequences: true` |
| `printWidth` / `proseWrap` | no analog — see below |
| comments (best-effort) | `preserveComments: true` (the default) |

Two defaults differ from Prettier's output and are worth setting explicitly. The stringify default is `quoteStyle: "single"` for byte-compatibility with the kit's legacy form, so if you ran Prettier with its own default (`singleQuote: false`), set `quoteStyle: "double"`. Likewise `indentSequences` defaults to `false` — the flat legacy form with the `-` markers at the key's column — while Prettier always indented block sequences one level, so an ex-Prettier consumer almost certainly wants `indentSequences: true`.

One expectation to reset when carrying over `singleQuote`: on the format path, `quoteStyle` governs quotes the stringifier *introduces* — it never re-quotes scalars that already carry quotes in your source. Formatting `a: 'x'` with `quoteStyle: "double"` leaves `'x'` untouched; Prettier would have rewritten it to `"x"`. Existing quote styles are source, and the formatter preserves source. If it looks like the option "does nothing" on an already-quoted corpus, this is why — the same class of format-path inertness as `lineWidth` below.

`printWidth` and `proseWrap` have no analog here: `lineWidth` folding is a value-path feature only (`Yaml.stringify` / `Yaml.stringifyResult`), and the option is deliberately inert on the format path by contract — `YamlFormat` never reflows scalar content (the `lineWidth` TSDoc on `YamlStringifyOptions` pins this). Comments, which Prettier handled best-effort, are preserved exactly by default.

Multi-document streams — a Kubernetes manifest, or the two-document `pnpm-lock.yaml` pnpm 11 writes under `configDependencies` — format whole: every document is re-emitted in order with its own `---`/`...` framing and comments, so no document is ever dropped. Document detection is CST-level, so a `---` inside a block scalar or quoted string is content and formats normally. The formatter leaves input byte-identical rather than corrupting it in exactly two cases: a fatal parse error in any document, and a stream carrying `%YAML`/`%TAG` directives (which the emitter cannot re-emit faithfully). Validate a whole stream with `Yaml.parseAllResult`, which fails typed when any document carries a fatal diagnostic; `YamlFormat.modify` stays single-document, since a path names no particular document of a stream.

## Features

- `Yaml.parse` / `Yaml.parseAll` — error-recovery parsing of a single document or a `---`-separated stream into plain values, resolving anchors and aliases and aggregating every diagnostic into one `YamlParseError`.
- `Yaml.stringify` — serialize a plain value back to YAML, failing typed with `YamlStringifyError` on circular references or on excessively deep nesting; a block-mapping key too long to render on one line spills into explicit-key form (`? key` / `: value`) so strict parsers still accept the output.
- `Yaml.parseResult` / `Yaml.parseAllResult` / `Yaml.stringifyResult` — the pure synchronous counterparts, returning a `Result` instead of an `Effect` for config-time callers that cannot await; each runs the same engine call as its `Effect` variant, so the two forms cannot diverge, and a fatal diagnostic, a duplicate key, an alias bomb or a circular reference still fails typed rather than throwing. `parseAllResult` doubles as a whole-stream validity check: it fails when any document in the stream is invalid.
- `Yaml.stripComments` — quote-aware comment removal that keeps line numbers stable, or every byte offset stable when given a replacement character.
- `Yaml.equals` / `Yaml.equalsValue` — semantic equality that ignores comments, whitespace, formatting and mapping key order while keeping sequence order significant.
- `Yaml.schema` / `Yaml.fromString` / `Yaml.YamlFromString` / `Yaml.allFromString` — string→domain schema factories that decode a single document or a whole stream into a validated Effect `Schema` value.
- `YamlNode` — an offset-preserving AST (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`) for locating and reading nodes by position or path, each collection and scalar carrying its own `commentBefore`, `comment` and `spaceBefore`.
- `YamlDocument` — the full parsed AST plus the recovered `errors` and `warnings` arrays, so a partially valid document is still inspectable, and the leading and trailing comment blocks as `comment` / `commentAfter`.
- `YamlEdit` / `YamlFormat` — compute byte-minimal edit arrays for formatting and path-based modification, so a change preserves every comment and byte you did not touch; `preserveComments: false` opts out. `format` handles multi-document streams whole, re-emitting every document and its framing; `modify` is single-document by contract (a path names no particular document of a stream) and fails typed with `MultiDocumentStream` rather than guessing.
- `YamlVisitor` — walk a parsed document as a `Stream` of a tagged-enum event union, with `Stream.take` early termination on large inputs and a `placement` on every comment event.
- `YamlToken` / `YamlTokens` — the positioned token stream the lint rules read: `tokenize` is a synchronous `Result` that always succeeds, surfacing lexical problems as `error`-kind tokens, and `stream` derives an Effect `Stream` from the same walk.
- `YamlLint` — `run`, `fix` and the `builtins` catalog: 14 rules covering parse validity, line length, trailing whitespace, blank lines, end-of-file newline, document markers, duplicate keys, quoting, truthy spellings, comment and colon and hyphen spacing, and indentation.
- `YamlLintConfig` / `YamlLintRule` / `YamlLintDiagnostic` — the `default` and `relaxed` presets, a config schema validated against the rule catalog, and the model a custom rule implements.
- `YamlParseError` / `YamlStringifyError` / `YamlModificationError` — tagged errors carrying structured, positional `YamlDiagnostic` arrays rather than opaque messages.

## License

[MIT](LICENSE)
