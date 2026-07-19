---
"@effected/yaml": minor
---

## Breaking Changes

### `YamlEdit.applyAll` rejects overlapping edits

`YamlEdit.applyAll` now checks the sorted edit array for overlapping spans
and throws as a defect when it finds one, instead of silently producing
corrupt text. Previously two edits covering the same range were applied one
after the other in reverse-offset order, and the result depended on how far
they overlapped.

```ts
import { YamlEdit } from "@effected/yaml";

// Overlapping spans: [0, 5) and [3, 8)
YamlEdit.applyAll("port: 3000\n", [
	YamlEdit.make({ offset: 0, length: 5, content: "host" }),
	YamlEdit.make({ offset: 3, length: 5, content: "x" }),
]);
// throws: YamlEdit.applyAll received overlapping edits at offsets 0 and 3
```

This only reaches hand-constructed edit arrays — `YamlFormat` never emits
overlapping edits, so anything flowing from the formatter is unaffected.
Overlapping edits are a programmer error, and a defect is how the kit
reports one. This matches `@effected/toml`, so all four format packages now
take the same posture.

## Features

### `Yaml.bind(target)`

Added `Yaml.bind`, which composes `Yaml.schema(target)` once and hands back
a `YamlBoundCodec` carrying that `schema` plus `decode` and `encode`
functions already derived from it. Call sites stop reaching for
`Schema.decodeEffect` / `Schema.encodeEffect` around a domain schema every
time they touch a YAML file.

```ts
import { Yaml } from "@effected/yaml";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const config = Yaml.bind(Config);

const program = Effect.gen(function* () {
	const value = yield* config.decode("port: 3000");
	// => { port: 3000 }
	return yield* config.encode(value);
	// => "port: 3000\n"
});
```

Both directions fail with `Schema.SchemaError`, exactly as
`Schema.decodeEffect` / `Schema.encodeEffect` over `Yaml.schema` do, and the
target's decoding and encoding service requirements flow through to `RD` and
`RE`.

`bind` covers the plain single-document form only — default parse options on
the way in, default stringify options on the way out. Multi-document streams
stay on `Yaml.allFromString`, composed directly.

Like the other schema factories, `bind` is schema-producing: each call
composes a fresh schema and derives a fresh pair of directions. Bind the
result to a `const` and reuse it — that single binding is the point.
