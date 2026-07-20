# @effected/yaml

## 0.5.0

### Features

* ### `quoteStyle`: choose the fallback quote character for plain scalars

  `YamlStringifyOptions` gains a `quoteStyle` field selecting the quote style used when a `plain`-styled scalar turns out to require quoting. It answers the one question the existing options could not: consumers migrating off the `yaml` npm package ran it with `singleQuote: false` and got double-quoted fallbacks, so every quoted scalar in their files was reformatted on the first write.

  ```ts
  import { Yaml } from "@effected/yaml";

  const value = { allowBuilds: { "@parcel/watcher": true } };

  yield* Yaml.stringify(value);
  // allowBuilds:
  //   '@parcel/watcher': true

  yield* Yaml.stringify(value, { quoteStyle: "double" });
  // allowBuilds:
  //   "@parcel/watcher": true
  ```

  The default is `"single"`, so output is byte-identical for every caller that does not opt in. `quoteStyle` governs the plain fallback only: scalars needing no quoting stay plain, and an explicit `defaultScalarStyle` of `"single-quoted"` or `"double-quoted"` still wins. On that plain fallback path, values carrying a tab, a carriage return or any other C0 control character are always emitted double-quoted whichever `quoteStyle` is set, since only double quotes can escape them into a form that round-trips exactly. Mapping keys take the same fallback as values, which is where the reformatting was most visible.

  `YamlFormattingOptions` derives the field along with the rest of the stringify options. On the document path it applies to scalars with no style of their own — a value `YamlFormat.modify` just inserted — since composed nodes keep the style they were parsed with.

  The new `QuoteStyle` schema (`"single" | "double"`) is exported alongside `ScalarStyle` and `CollectionStyle`.

  ### `parseSync` and `stringifySync` are now `parseResult` and `stringifyResult`

  The two synchronous `Result`-returning entry points take the kit-wide spelling:

  ```ts
  Yaml.parseSync(text, options?)      // -> Yaml.parseResult(text, options?)
  Yaml.stringifySync(value, options?) // -> Yaml.stringifyResult(value, options?)
  ```

  Signatures, semantics, return types and error types are unchanged; only the names move. `@effected/jsonc` and `@effected/markdown` already spelled this capability `parseResult` / `stringifyResult`, and `Sync` named a distinction that does not exist — the `Effect` form is synchronous too, so the return type is the only thing that actually differs. The `Sync` suffix is also spoken for elsewhere in the kit, where `@effected/workspaces` uses it for genuinely IO-performing functions that return nullables rather than a `Result`.

  ### `Yaml.parse` is now defined in terms of `Yaml.parseResult`

  `Yaml.parse` previously drove the composer, the failure-record collection and the alias-expansion budget inline, duplicating the engine call that `parseResult` already made — two live copies of one parse path, which is exactly how a fidelity fix lands in one copy and not the other. `Yaml.parse` is now `Effect.fromResult(Yaml.parseResult(...))` behind its existing `Yaml.parse` tracing span, matching `Jsonc.parse`, so `parseResult` is the package's single parse path and the two forms cannot diverge.

  This is an internal restructuring: the `Yaml.parse` signature, its error channel and its span are unchanged. The equivalence was verified by differentially comparing the new and previous implementations across all 402 yaml-test-suite fixtures under both `uniqueKeys` settings, plus the alias-expansion bomb, bounded `maxAliasCount`, duplicate-key promotion and C0-control-character inputs. The conformance harness stays at 1226/1226.

### Bug Fixes

* ### Carriage returns and interior tabs are no longer emitted as plain scalars

  `Yaml.stringify` emitted a string containing a carriage return or an interior tab as an unquoted plain scalar. The carriage-return case was silent data corruption: `stringify` produced `cr: has<CR>carriage`, and parsing that back returned `has carriage` — the carriage return normalised to a space, with no error raised on either leg. The tab case round-tripped through this package but produced text other YAML parsers reject outright, `yaml` (via Prettier) reporting `MULTILINE_IMPLICIT_KEY — Implicit keys need to be on a single line`.

  The quoting gate tested only `isControlChar`, which deliberately excludes tab (`0x09`) and carriage return (`0x0D`) because the block-scalar and single-quoted-multiline paths can represent both. A leading or trailing tab was already caught by a separate whitespace check, leaving the interior tab and every carriage return unquoted. Both are now tested explicitly at that gate, so such values take the double-quoted fallback and round-trip exactly. Only single-line values reach the gate, so multi-line strings containing tabs still use block scalars as before.

  Values containing NUL, bell, escape and the other C0 control characters were already quoted correctly and are unchanged; they now have regression coverage alongside the two fixed cases. The yaml-test-suite conformance harness stays at 1226/1226.

  ### The merge key is no longer quoted on re-emission

  `YamlFormat.format` / `.formatToString` and `YamlDocument#stringify` rewrote a plain `<<` mapping key as `'<<'`. A plain `<<` resolves to `tag:yaml.org,2002:merge` and splices the aliased mapping into its parent; `'<<'` is an ordinary string key that merges nothing. Formatting a document therefore changed what it meant, with no error raised — the output still parsed and still round-tripped, which is why nothing caught it. Merge keys are common in Docker Compose, GitLab CI and Kubernetes manifests, so a format-on-save over a repository of such files silently broke every one of them.

  `<<` was reaching the "leading indicator character" branch of the plain-scalar quoting gate. The fix is a carve-out at the mapping-key boundary rather than a relaxation of that gate: a key that is a plain-styled scalar with no tag and no anchor, whose value is exactly `<<`, is emitted plain. Both the block and the flow mapping branches route through one helper, so the two cannot disagree.

  The carve-out is deliberately narrow, and reads the key's source style:

  * An explicitly quoted `'<<'` or `"<<"` key keeps its quotes — the author wrote a literal string key, and that is preserved.
  * `<<` in **value** position is untouched. Plain and quoted resolve to the same string there, so no semantics ride on it.
  * The **value path** (`Yaml.stringify` over a plain JS object) still quotes a `"<<"` key. That direction is the mirror image: a JS key `"<<"` carries no merge intent, so emitting it plain would *create* merge semantics the input never had.

  This was pre-existing on the `0.4.0` line, not a consequence of the `quoteStyle` work above — verified by running the repro through the pre-change sources, which produce byte-identical output. The yaml-test-suite corpus contains no merge-key fixtures at all (merge is a YAML 1.1 type-repository feature, outside YAML 1.2 core), so conformance was structurally incapable of catching this; coverage is added directly instead. Conformance stays at 1226/1226. [#125][#125]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.4.0

### Breaking Changes

* ### `YamlEdit.applyAll` rejects overlapping edits

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

### Features

* ### `Yaml.bind(target)`

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
  result to a `const` and reuse it — that single binding is the point. [#122][#122]

### Dependencies

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#122]: https://github.com/spencerbeggs/effected/pull/122

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
