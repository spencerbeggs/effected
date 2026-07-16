# @effected/yaml

Zero-dependency YAML 1.2 parsing, editing and formatting as Effect schemas. Inputs are strings; outputs are values, documents, edits, streams or typed errors. Pure tier: peers only on `effect`; the lex→CST→compose→stringify engine is vendored from the `yaml` npm package with attribution — never add `yaml` itself as a dependency alongside it.

## Import

```ts
import { Yaml, YamlDocument, YamlFormat, YamlNode, YamlVisitor } from "@effected/yaml";
```

Single entrypoint; no subpaths.

## Core API

- **`Yaml`** (facade) — `parse(text, options?)` / `parseAll(text, options?)` → `Effect<unknown, YamlParseError>`; `stringify(value, options?)` → `Effect<string, YamlStringifyError>`; `stripComments`, `equals`/`equalsValue` (pure). Schema factories `Yaml.schema(Target, options?)`, `Yaml.fromString(options?)`, `Yaml.allFromString(options?)`, and the pre-bound `Yaml.YamlFromString` singleton.
- **`YamlDiagnostic`** — structured diagnostics (errors AND warnings as data) with staged code unions (`YamlLexErrorCode`, `YamlComposerErrorCode`, `YamlModifyErrorCode`, `YamlParseErrorCode`, `YamlStringifyErrorCode`).
- **`YamlDocument`** / **`YamlNode`** family (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`) — error-tolerant full AST carrying recovered `errors`/`warnings`.
- **`YamlEdit`** + `applyAll`, **`YamlFormat`** (`format`/`modify`, comment- and whitespace-preserving) — the edit pipeline, structurally parallel to jsonc's.
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

## Testing machinery

None exported (the yaml-test-suite compliance harness is internal CI, not shipped).

## Gotchas

- Duplicate keys fail by default (`uniqueKeys: true`).
- Per-node comments are captured on parse but NOT re-emitted by stringify — only a document-level leading comment round-trips. Known limitation, not a bug.
- Adversarial input (including billion-laughs alias bombs) fails through typed errors — the alias-expansion budget guards materialization, not just input depth; composer nesting caps at 256.
- The largest package in the kit: importing it pulls the full vendored engine; there are no partial entrypoints. Weigh that in bundle-sensitive consumers.
- Schema factories return fresh instances per call — bind to a `const`, or use `Yaml.YamlFromString`.
