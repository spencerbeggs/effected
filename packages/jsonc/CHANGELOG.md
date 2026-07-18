# @effected/jsonc

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
