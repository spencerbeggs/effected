# @effected/jsonc

Zero-dependency JSONC (JSON with comments) parse/edit/format as Effect schemas: parse to values or an AST, strip comments offset-preservingly, compute byte-minimal edits, format, modify by path, visit as a `Stream`. Pure tier: peers only on `effect`; the engine is a vendored, hardened port of Microsoft's `jsonc-parser`.

## Import

```ts
import { Jsonc, JsoncEdit, JsoncFormatter, JsoncModifier, JsoncNode, JsoncVisitor } from "@effected/jsonc";
```

Single entrypoint; no subpaths.

## Core API

- **`Jsonc`** (facade) — `parse(text, options?)` → `Effect<unknown, JsoncParseError>` (error-recovering; aggregates all parse errors into one typed failure); `parseTree(text, options?)` → `Effect<Option<JsoncNode>, JsoncParseError>`; `stripComments(text, replaceCh?)` (pure); `equals`/`equalsValue` (pure, key-order-independent). Schema factories: `Jsonc.fromString(options?)` decodes a JSONC string to `unknown`; `Jsonc.schema(Target, options?)` decodes straight into your schema; `Jsonc.JsoncFromString` is the pre-bound default-options singleton.
- **`JsoncNode`** — recursive AST class (no parent pointers): `find(path)`, `findAtOffset(offset)`, `pathAt(offset)`, `toValue()`. Absence is `Option`, never an error.
- **`JsoncEdit`** + `applyAll(text, edits)`, **`JsoncFormatter`** (`format`, `formatToString`), **`JsoncModifier`** (`modify(text, path, value)` — `value === undefined` deletes) — the comment-preserving edit pipeline.
- **`JsoncVisitor`** — SAX-style `visit(text)` → `Stream<JsoncVisitorEvent>`; malformed input surfaces as an error *event*, not a stream failure.

## Usage

```ts
import { Jsonc } from "@effected/jsonc";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromJsonc = Jsonc.schema(Config);

const program = Effect.gen(function* () {
 return yield* Schema.decodeUnknownEffect(ConfigFromJsonc)('{ "port": 3000 // dev\n }');
});
```

## Testing machinery

None exported.

## Gotchas

- `fromString(options)` / `schema(Target, options)` return a FRESH schema per call, and v4 derivation caches by reference — bind the produced schema to a `const`; use `Jsonc.JsoncFromString` for the default case.
- `allowTrailingComma` defaults to `true`.
- `equals`/`equalsValue` return `false` whenever either side has parse errors — malformed input is never equal to anything, including itself.
- Nesting depth is capped at 256 across all five surfaces (parse, walkers, equals, visitor, modifier); the cap fails through the typed error channel, never a `RangeError`.
