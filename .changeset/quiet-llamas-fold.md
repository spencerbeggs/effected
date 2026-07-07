---
"@effected/yaml": minor
---

## Features

Initial release of `@effected/yaml` — zero-dependency YAML parsing, editing and formatting as Effect `Schema` codecs and pure functions, structurally parity-matched to `@effected/jsonc`'s edit vocabulary. Parse into plain values or an offset-preserving AST, strip comments, compute diagnostics-carrying edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema:

```ts
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromYaml = Yaml.schema(Config);

const program = Effect.gen(function* () {
	const config = yield* Schema.decodeUnknownEffect(ConfigFromYaml)(`
port: 3000 # dev server
`);
	return config; // { port: 3000 }
});
```

### Parsing and Comments

* `Yaml.parse` / `Yaml.parseAll` — error-recovery parsing of a single document or a multi-document stream into plain values, resolving anchors and aliases; both fail with an aggregate `YamlParseError`.
* `Yaml.stringify` — encode a plain value as YAML text, failing with `YamlStringifyError` on circular references.
* `Yaml.stripComments` — pure, offset-preserving comment removal; quote-aware, so `#` inside a quoted scalar is content, not a comment.
* `Yaml.equals` / `Yaml.equalsValue` — semantic equality ignoring comments, whitespace, formatting and mapping key order; malformed input on either side is never equal to anything.

### Schema Factories

* `Yaml.fromString(options?)` — a fresh `Schema<unknown, string>` decoding YAML per call.
* `Yaml.YamlFromString` — the pre-bound zero-config version of the above.
* `Yaml.allFromString(options?)` — decodes a multi-document stream into `ReadonlyArray<unknown>`, encoding back to a `---`-separated stream.
* `Yaml.schema(target, options?)` — composes `Yaml.fromString` with a target schema, decoding YAML directly into a validated domain value.

### AST and Documents

* `YamlNode` — the `YamlScalar | YamlMap | YamlSeq | YamlAlias` union, each with `find(path)` / `findAtOffset(offset)` / `pathOf(node)` / `toValue(anchors?)` instance methods (alias-resolving).
* `YamlDocument` — `parse` / `parseAll` / `schema` statics and `stringify` / `toValue` instance methods; recovered errors and warnings ride as data on `errors` / `warnings` rather than failing the Effect, so callers can inspect a partially-valid document.

### Editing and Formatting

* `YamlEdit` (+ `YamlRange`, `YamlPath`, `YamlSegment`) — non-destructive text edits with a static `YamlEdit.applyAll`, structurally parity-matched to `@effected/jsonc`'s edit vocabulary.
* `YamlFormat.format` / `formatToString` (pure) and `YamlFormat.modify` / `modifyToString` (`Effect<_, YamlModificationError>`), configured via `YamlFormattingOptions`.
* `YamlVisitor.visit` — walks a document as a `Stream` of a tagged event union; malformed input surfaces as error events, and a `maxAliasCount` guard protects against alias-expansion denial-of-service inputs.

### Typed Errors and Diagnostics

Every error type — `YamlParseError`, `YamlStringifyError`, `YamlModificationError` — carries a structured `YamlDiagnostic` (`code` / `message` / `offset` / `length` / `line` / `character`) rather than an opaque message. Hardening baked into the parser: `__proto__` keys decode as own data properties rather than prototype pollution, raw C0 control characters are rejected, and nesting depth is capped (`NestingDepthExceeded`) so hostile input errors out instead of overflowing the stack.
