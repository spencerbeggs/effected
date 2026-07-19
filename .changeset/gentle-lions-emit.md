---
"@effected/jsonc": minor
---

## Breaking Changes

### `JsoncEdit.applyAll` rejects overlapping edits

`applyAll` now throws when two edits cover the same span, instead of
applying them in reverse-offset order and silently producing corrupted
text:

```ts
import { JsoncEdit } from "@effected/jsonc";

const edits = [
	JsoncEdit.make({ offset: 0, length: 5, content: "hello" }),
	JsoncEdit.make({ offset: 3, length: 2, content: "world" }),
];

JsoncEdit.applyAll('{ "a": 1 }', edits);
// throws: JsoncEdit.applyAll received overlapping edits at offsets 0 and 3
// — overlapping edits are a programmer error
```

Overlapping edits are a programmer error on a hand-constructed array, not
hostile input, so the guard is a thrown defect rather than a typed failure —
the package's hardening invariant still holds for everything that comes off
the parser. `JsoncFormatter` and `JsoncModifier` never emit overlapping
edits, so nothing that goes straight from a producer into `applyAll` is
affected. This adopts toml's posture; all four format packages now agree.

## Features

### `Jsonc.stringify` / `Jsonc.stringifyResult`

The facade gained the emission direction it was missing. With no options the
output is byte-identical to `JSON.stringify(value, null, 2)`:

```ts
import { Jsonc } from "@effected/jsonc";
import { Result } from "effect";

const ok = Jsonc.stringifyResult({ port: 3000, tags: ["a"] });
if (Result.isSuccess(ok)) {
	console.log(ok.success);
	// {
	//   "port": 3000,
	//   "tags": [
	//     "a"
	//   ]
	// }
}
```

`stringify` is the `Effect` form (carrying a `Jsonc.stringify` tracing span)
and `stringifyResult` the synchronous `Result` form the first is defined in
terms of — the same pairing as `parse`/`parseResult`. Failures carry a
`JsoncStringifyError` whose `code` is a `JsoncStringifyErrorCode`:
`CircularReference`, `BigIntValue` or `TopLevelUnrepresentable`, plus the
engine's `detail` message and the offending `value`.

```ts
const bad = Jsonc.stringifyResult(0n);
if (Result.isFailure(bad)) {
	console.log(bad.failure.code);
	// "BigIntValue"
}
```

The typed channel is deliberately narrow. **Nested** unrepresentable values
follow `JSON.stringify`'s documented semantics — `undefined`, functions and
symbols are dropped from objects and become `null` in arrays — rather than
erroring, because that is JSON's contract and matching it is the point. A
throwing `toJSON` method or getter is caller code failing and rethrows as a
defect.

`JsoncStringifyOptions` carries `tabSize` and `insertSpaces`, the same
vocabulary as `JsoncFormattingOptions`. A `tabSize` of `0` produces compact
single-line output; `insertSpaces: false` indents with tabs:

```ts
const compact = Jsonc.stringifyResult({ port: 3000 }, { tabSize: 0 });
if (Result.isSuccess(compact)) {
	console.log(compact.success);
	// {"port":3000}
}
```

This is plain JSON emission, not JSONC. Comments live only in the
document/edit layer (`JsoncNode`, `JsoncEdit`, `JsoncFormatter`), so no
comment survives — or can be produced by — value-level stringification.

`Jsonc.fromString` and `Jsonc.JsoncFromString` now ride this on their encode
side, so a circular or `bigint` value fails as a schema issue during encode
instead of throwing a defect out of the codec.

### `Jsonc.bind(target)`

`bind` composes a target schema with the JSONC codec once and hands back a
`JsoncBoundCodec` — the `schema` plus both directions pre-derived, so the use
site needs no generic `Schema` machinery:

```ts
import { Jsonc } from "@effected/jsonc";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const config = Jsonc.bind(Config);

const program = Effect.gen(function* () {
	const value = yield* config.decode('{ "port": 3000 // dev\n }');
	// { port: 3000 }
	const text = yield* config.encode(value);
	// '{\n  "port": 3000\n}'
	return [value, text] as const;
});
```

Both directions fail with `Schema.SchemaError`, exactly as
`Schema.decodeEffect`/`Schema.encodeEffect` over `Jsonc.schema(target)`
would; `bind` adds no error taxonomy of its own. The target's decoding and
encoding service requirements flow through as `RD`/`RE`.

Like `fromString` and `schema`, `bind` is schema-producing — each call
composes a fresh schema and derives both directions from it. Bind the result
to a `const`; that single binding is the whole point.

`Jsonc.schema` also gained `RD`/`RE` service generics, bringing it to parity
with the yaml and toml facades.
