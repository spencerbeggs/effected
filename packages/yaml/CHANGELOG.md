# @effected/yaml

## 0.3.1

### Documentation

* Clarify that `lineWidth` scalar folding is a value-path-only feature:
  `Yaml.stringify`/`Yaml.stringifySync` honor it, while `YamlDocument#stringify`
  and the `YamlFormat` helpers accept the option but never fold — callers
  needing folded output on that path should render the plain value instead
  (`Yaml.stringify(doc.toValue(), options)`).
* Fixed two `{@link Result}` cross-package references that produced
  `ae-unresolved-link` warnings in the production build; the package now
  builds warning-free. [#112][#112]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#112]: https://github.com/spencerbeggs/effected/pull/112

## 0.3.0

### Features

* `Yaml.parseSync` and `Yaml.stringifySync` — synchronous escape hatches returning a `Result` instead of an `Effect`, for config-time callers that cannot `await` (a `vitest.config.ts` is the motivating case). They run the same engine as the Effect variants and honor the package contract: malformed or adversarial input (fatal diagnostics, duplicate keys, a "billion laughs" alias-expansion blow-up, a circular reference, or a value nested past the recursion budget) yields a `Failure` carrying the typed `YamlParseError` / `YamlStringifyError` — never a thrown defect.

  `YamlStringifyOptions.lineWidth` now performs real column-based scalar folding. A positive value folds long plain, double-quoted and block-folded (`>`) scalars at approximately that column, inserting only semantically transparent line breaks (round-trip is preserved); block-literal (`|`) content is never folded.

  * `parseSync(text, options?): Result<unknown, YamlParseError>`
  * `stringifySync(value, options?): Result<string, YamlStringifyError>`

  ### lineWidth default is now 0 (never wrap)

  `lineWidth` previously had no effect — it was threaded into the stringifier but never read, so output never wrapped. Its default changes from `80` to `0`, where `0` (and any value `<= 0`) means never wrap. Output for the default path, and for anyone already passing `lineWidth: 0`, is byte-identical to before. A caller passing a positive `lineWidth` now opts into folding, where previously the value was inert. [#106][#106]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.2.0

### Features

* ### `indentSequences` formatting option

  `YamlStringifyOptions` and `YamlFormattingOptions` gain `indentSequences`, controlling how block sequences nested under a mapping key are presented. The default, `false`, keeps the kit's existing byte-compatible output (sequence items at the key's column); `true` indents them one level, matching the `yaml` npm package's default.

  ```ts
  import { Yaml, YamlStringifyOptions } from "@effected/yaml";

  const options = YamlStringifyOptions.make({ indentSequences: true });
  Yaml.stringify({ key: ["a", "b"] }, options);
  // key:
  //   - a
  //   - b
  ```

  Top-level sequences stay at column zero in both modes. Existing output is unchanged unless `indentSequences` is set explicitly. [#91][#91]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.1.0

### Features

* Zero-dependency YAML 1.2 parsing, editing and formatting expressed as Effect schemas and pure functions. Parse a single document or a multi-document stream into plain values or an offset-preserving AST, resolve anchors and aliases, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema. The lexer, CST parser, composer and stringifier are vendored into the package with attribution — `effect` is the only runtime dependency.

  ### Decode straight into a domain schema

  `Yaml.schema` composes with your own `Schema`; `Yaml.stringify` goes the other way, failing typed on circular references rather than throwing.

  ```ts
  import { Yaml } from "@effected/yaml";
  import { Effect, Schema } from "effect";

  const Config = Schema.Struct({ port: Schema.Number });
  const ConfigFromYaml = Yaml.schema(Config);

  const program = Effect.gen(function* () {
    return yield* Schema.decodeUnknownEffect(ConfigFromYaml)("port: 3000 # dev server");
  });

  Effect.runPromise(program).then(console.log);
  // { port: 3000 }
  ```

  ### Hostile input fails typed

  An alias bomb — nested anchors whose expansion multiplies at every level — is bounded by an expansion budget and surfaces as a `YamlParseError`, not an out-of-memory kill. Collection nesting past the depth cap yields a `NestingDepthExceeded` diagnostic instead of a stack overflow, and `Yaml.stringify` caps the mirror-image recursion when encoding back to text.

  ```ts
  import { Yaml } from "@effected/yaml";
  import { Effect } from "effect";

  const bomb = ["a: &a [x,x,x,x,x,x,x,x,x]", "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]", "z: [*g,*g,*g,*g,*g,*g,*g,*g,*g]"].join("\n");

  Effect.runPromise(Effect.result(Yaml.parse(bomb))).then(console.log);
  // Failure with YamlParseError, whose `diagnostics` carry:
  // { code: "AliasCountExceeded", message: "Alias expansion exceeded budget of ... nodes" }
  ```

  `Yaml.parse` / `Yaml.parseAll` recover single documents or `---`-separated streams into plain values, aggregating every diagnostic into one `YamlParseError`. `YamlNode` is the offset-preserving AST (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlPair`, `YamlAlias`); `YamlDocument` adds the recovered `errors` and `warnings`; `YamlEdit` / `YamlFormat` compute comment-preserving edits; and `YamlVisitor` streams AST events. Every fallible entry point carries a real error channel — nothing reaches your process as a defect. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
