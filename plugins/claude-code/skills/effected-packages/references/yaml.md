# @effected/yaml

Zero-dependency YAML 1.2 parsing, editing and formatting as Effect schemas. Inputs are strings; outputs are values, documents, edits, streams or typed errors. Pure tier: peers only on `effect`; the lex→CST→compose→stringify engine is vendored from the `yaml` npm package with attribution — never add `yaml` itself as a dependency alongside it.

## Import

```ts
import { Yaml, YamlDocument, YamlFormat, YamlNode, YamlStringifyOptions, YamlVisitor } from "@effected/yaml";
```

Single entrypoint; no subpaths.

## Core API

- **`Yaml`** (facade) — `parse(text, options?)` / `parseAll(text, options?)` → `Effect<unknown, YamlParseError>`; `stringify(value, options?)` → `Effect<string, YamlStringifyError>`; `stripComments`, `equals`/`equalsValue` (pure). Schema factories `Yaml.schema(Target, options?)`, `Yaml.fromString(options?)`, `Yaml.allFromString(options?)`, and the pre-bound `Yaml.YamlFromString` singleton. `YamlParseOptions` fields: `strict` (default `true`), `maxAliasCount` (default `100` — the alias-expansion denial-of-service guard), `uniqueKeys` (default `true`).
- **`YamlStringifyOptions`** — construct with `YamlStringifyOptions.make({ ... })` (never `new`). Fields: `indent` (default `2`), `lineWidth` (default `80`; `0` disables wrapping), `defaultScalarStyle` (`"plain" | "single-quoted" | "double-quoted" | "block-literal" | "block-folded"`, default `"plain"`), `defaultCollectionStyle` (`"block" | "flow"`, default `"block"`), `sortKeys` (default `false`), `finalNewline` (default `true`), `forceDefaultStyles` (default `false`), and **`indentSequences`** (round-3 addition, default `false`) — controls how a block sequence nested under a mapping key is presented: `false` emits it at the key's own column (the kit's byte-compatible legacy form), `true` indents it one level, matching the upstream `yaml` npm package's default output. Top-level sequences stay at column zero either way.
- **`YamlDiagnostic`** — structured diagnostics (errors AND warnings as data) with staged code unions (`YamlLexErrorCode`, `YamlComposerErrorCode`, `YamlModifyErrorCode`, `YamlParseErrorCode`, `YamlStringifyErrorCode`).
- **`YamlDocument`** / **`YamlNode`** family (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`) — error-tolerant full AST carrying recovered `errors`/`warnings`.
- **`YamlEdit`** + `applyAll`, **`YamlFormat`** (`format`/`formatToString`, comment- and whitespace-preserving; `modify`/`modifyToString`, structural path-targeted edits) — the edit pipeline, structurally parallel to jsonc's. **`YamlFormattingOptions`** derives every `YamlStringifyOptions` field (including `indentSequences`) plus `preserveComments` (default `true`) and `range` (restrict edits to a region). `YamlFormat.modify`/`modifyToString` take a bare `YamlStringifyOptions` (not `YamlFormattingOptions` — there is no range to restrict for a path-targeted edit) and only support scalar-compatible values, not arbitrary object graphs. `YamlModificationError` carries `path`/`diagnostics: ReadonlyArray<YamlDiagnostic>` — never a collapsed `reason` string.
- **`YamlVisitor`** — SAX-style `Stream<YamlVisitorEvent>`; diagnostics surface as `Error` events, never a stream failure.

## Usage

```ts
import { Yaml } from "@effected/yaml";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  return yield* Yaml.parse("name: Alice\ntags:\n  - a\n  - b");
});
```

```ts
// duplicate keys fail by default; opt out explicitly
const value = Effect.runSync(Yaml.parse("a: 1\na: 2", { uniqueKeys: false }));
```

Parse → mutate the plain value → stringify round-trip for a YAML config file, run from a synchronous context (e.g. a lint-staged hook) via `Effect.result` instead of letting a parse failure throw:

```ts
import { Yaml, YamlStringifyOptions } from "@effected/yaml";
import { Effect, Result } from "effect";

interface WorkspaceConfig {
  packages?: string[];
  [key: string]: unknown;
}

const STRINGIFY_OPTIONS = YamlStringifyOptions.make({ indent: 2, lineWidth: 0 });

function updatePackagesList(source: string, packages: ReadonlyArray<string>): string {
  const parsed = Effect.runSync(Effect.result(Yaml.parse(source)));
  if (Result.isFailure(parsed)) {
    throw new Error(`Invalid YAML: ${parsed.failure.message}`);
  }
  const config = { ...(parsed.success as WorkspaceConfig), packages: [...packages].sort() };
  return Effect.runSync(Yaml.stringify(config, STRINGIFY_OPTIONS));
}
```

## Testing machinery

None exported (the yaml-test-suite compliance harness is internal CI, not shipped).

## Gotchas

- Duplicate keys fail by default (`uniqueKeys: true`).
- Per-node comments are captured on parse but NOT re-emitted by stringify — only a document-level leading comment round-trips. Known limitation, not a bug.
- `indentSequences` defaults to `false`: a block sequence nested under a mapping key sits at the key's own column, not indented one level under it. Code migrating from another YAML stringifier that indents sequences by default needs `{ indentSequences: true }` to match its byte output.
- Adversarial input (including billion-laughs alias bombs) fails through typed errors — the alias-expansion budget guards materialization, not just input depth; composer nesting caps at 256.
- The largest package in the kit: importing it pulls the full vendored engine; there are no partial entrypoints. Weigh that in bundle-sensitive consumers.
- Schema factories return fresh instances per call — bind to a `const`, or use `Yaml.YamlFromString`.
