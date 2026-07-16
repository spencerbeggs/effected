# @effected/jsonc

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
