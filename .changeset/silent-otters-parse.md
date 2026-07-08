---
"@effected/jsonc": minor
---

## Features

Initial release of `@effected/jsonc` — a zero-dependency JSONC toolchain built as Effect `Schema` codecs and pure functions. Parse JSONC into plain values or an offset-preserving AST, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema:

```ts
import { Jsonc } from "@effected/jsonc";
import { Effect, Schema } from "effect";

const Config = Schema.Struct({ port: Schema.Number });
const ConfigFromJsonc = Jsonc.schema(Config);

const program = Effect.gen(function* () {
	const config = yield* Schema.decodeUnknownEffect(ConfigFromJsonc)(`{
  "port": 3000 // dev server
}`);
	return config; // { port: 3000 }
});
```

### Parsing and Comments

* `Jsonc.parse` / `Jsonc.parseTree` — error-recovery parsing to a plain value or an immutable `JsoncNode` AST; both aggregate every recovered error into a single `JsoncParseError` rather than failing on the first one.
* `Jsonc.stripComments` — pure, offset-preserving comment removal, producing valid JSON.
* `Jsonc.equals` / `Jsonc.equalsValue` — semantic equality that ignores comments, whitespace, formatting and key order.

### Schema Factories

* `Jsonc.fromString(options?)` — a fresh `Schema<unknown, string>` decoding JSONC per call.
* `Jsonc.JsoncFromString` — the pre-bound zero-config version of the above.
* `Jsonc.schema(target, options?)` — composes `Jsonc.fromString` with a target schema, decoding JSONC directly into a validated domain value.

### Editing

* `JsoncFormatter` and `JsoncModifier` compute byte-minimal `JsoncEdit` arrays for formatting and path-based modification, so callers can apply the smallest possible diff to a source document rather than re-serializing it.
* `JsoncVisitor` walks a parsed document as a `Stream` of visitor events.

### Typed Errors

`JsoncParseError` (parse failures, carrying the full `JsoncParseErrorDetail` batch with `line`/`character` positions) and `JsoncModificationError` (edit-computation failures) are `Schema.TaggedErrorClass` errors with structured payload fields, not opaque messages. Hardening baked into the parser: nesting depth is capped (`NestingDepthExceeded`) so hostile input errors out through `parse`, `parseTree`, `visit`, `modify`, and `equals`/`equalsValue` instead of overflowing the stack.
