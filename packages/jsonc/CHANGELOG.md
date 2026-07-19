# @effected/jsonc

## 0.4.0

### Breaking Changes

* ### `JsoncEdit.applyAll` rejects overlapping edits

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

### Features

* ### `Jsonc.stringify` / `Jsonc.stringifyResult`

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
  with the yaml and toml facades. [#122][#122]

### Dependencies

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.3.0

### Features

* Added `Jsonc.parseResult(text, options?)` — a pure, synchronous
  `Result`-returning parse variant for callers that are not already inside an
  `Effect`. It runs the same error-recovery engine as `Jsonc.parse`: every
  parse error is collected and the failure side carries one aggregate
  `JsoncParseError`.

  ```ts
  import { Jsonc } from "@effected/jsonc";
  import { Result } from "effect";

  const ok = Jsonc.parseResult('{ "port": 3000 // dev\n }');
  if (Result.isSuccess(ok)) {
  	console.log(ok.success); // => { port: 3000 }
  }

  const bad = Jsonc.parseResult("{ bad }");
  if (Result.isFailure(bad)) {
  	console.log(bad.failure._tag); // => "JsoncParseError"
  }
  ```

  `Jsonc.parse` is now defined in terms of `Jsonc.parseResult` — behavior is
  unchanged, and the `Effect` variant still carries the `Jsonc.parse` tracing
  span. Reach for `parseResult` at synchronous boundaries (a plain config
  loader, a build script) instead of wrapping
  `Effect.runSync(Effect.result(Jsonc.parse(text)))`. [#112][#112]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#112]: https://github.com/spencerbeggs/effected/pull/112

## 0.2.0

### Features

* ### `JsoncFormattingOptionsLike` — plain literals accepted for `formattingOptions`

  `JsoncModifyOptions.formattingOptions` now accepts either a `JsoncFormattingOptions` instance or a structurally-matching plain literal, exported as `JsoncFormattingOptionsLike`:

  ```ts
  import { JsoncModifier } from "@effected/jsonc";

  yield* JsoncModifier.modify(text, ["a"], 2, {
  	formattingOptions: { insertSpaces: false, tabSize: 2 },
  });
  ```

  `JsoncFormattingOptions` remains the canonical decoded form; only the option fields are read from either shape.

### Documentation

* Value spans for edits now cover exactly the value, byte-exact — a fix carried over from `jsonc-effect` 0.3.x, where spans over-reached trailing content and could swallow whitespace or comments after a value ([jsonc-effect#62](https://github.com/spencerbeggs/jsonc-effect/issues/62)). Consumers migrating from `jsonc-effect` can drop any downstream AST-plus-`trimEnd` workarounds. [#91][#91]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.1.0

### Features

* Zero-dependency JSONC parsing, editing and formatting expressed as Effect schemas and pure functions. JSONC is JSON with comments and trailing commas — the format behind `tsconfig.json` and VS Code settings — and this package treats the source text as the document: modifications are computed as byte-minimal edits against the original bytes, so a change to one key leaves every comment, blank line and indentation choice untouched. Parsing recovers from errors and aggregates every diagnostic into one `JsoncParseError` rather than throwing on the first. No IO, no services, no runtime dependency other than `effect`.

  ### Decode straight into a domain schema

  `Jsonc.schema` composes with your own `Schema` so a JSONC string decodes into a validated value in one step. Malformed input fails through the typed channel, never as a throw.

  ```ts
  import { Jsonc } from "@effected/jsonc";
  import { Effect, Schema } from "effect";

  const Config = Schema.Struct({ port: Schema.Number });
  const ConfigFromJsonc = Jsonc.schema(Config);

  const program = Effect.gen(function* () {
    return yield* Schema.decodeUnknownEffect(ConfigFromJsonc)(`{
      // dev server
      "port": 3000
    }`);
  });

  Effect.runPromise(program).then(console.log);
  // { port: 3000 }
  ```

  ### Editing without losing comments

  `JsoncModifier.modify` returns a `JsoncEdit` array — offset, length and replacement content — that `JsoncEdit.applyAll` splices into the original text. Only the bytes covered by an edit change.

  ```ts
  import { JsoncEdit, JsoncModifier } from "@effected/jsonc";
  import { Effect } from "effect";

  const source = `{
    // dev server
    "port": 3000
  }`;

  const program = Effect.gen(function* () {
    const edits = yield* JsoncModifier.modify(source, ["port"], 8080);
    return JsoncEdit.applyAll(source, edits);
  });

  Effect.runPromise(program).then(console.log);
  // {
  //   // dev server
  //   "port": 8080
  // }
  ```

  `Jsonc.parse` / `Jsonc.parseTree` recover to a plain value or an offset-preserving `JsoncNode` AST; `Jsonc.stripComments` yields valid JSON offset-preservingly; `JsoncFormatter` computes whitespace-normalizing edits; and `JsoncVisitor` walks a document as a `Stream` with `Stream.take` early termination. Hostile input (deep nesting, unterminated literals) fails through the error channel, never as a stack overflow. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
