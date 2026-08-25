# @effected/yaml

## 0.12.0

### Features

- Adds `quoteCompat: "yaml-1.1"` to `YamlStringifyOptions`. When set, the stringifier additionally quotes plain scalars that a YAML 1.1 resolver (js-yaml, PyYAML, libyaml) would implicitly coerce to a non-string — `yes`/`no`/`on`/`off` booleans, 1.1 timestamps, sexagesimals like `1:30`, underscored numbers, and other YAML 1.1 type ambiguities that this package's own YAML 1.2 rules would otherwise leave unquoted:

```ts
import { Yaml } from "@effected/yaml";
import { Result } from "effect";

const result = Yaml.stringifyResult({ enabled: "yes" }, { quoteCompat: "yaml-1.1" });
if (Result.isSuccess(result)) {
	result.success; // "enabled: 'yes'\n" — quoted so a 1.1 consumer reads it back as a string
}
```

- The option is strictly additive to the existing quoting rules, composes with `quoteStyle` (which still picks the quote character), and is available anywhere stringify options are accepted, on both the value path (`Yaml.stringify`, `Yaml.stringifyResult`) and the node path (`YamlDocument`, `YamlFormat`).

### Bug Fixes

- `YamlDocument.stringify` now honors `quoteStyle` — the document-path options adapter previously dropped the field, so node-path callers always got single quotes regardless of what they passed [#517][#517]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#517]: https://github.com/spencerbeggs/effected/pull/517

## 0.11.0

### Features

- Added lint config inference: `YamlLint` can now infer a `YamlLintConfig` from existing YAML documents instead of requiring one to be hand-written.
  - `YamlLint.observe(text, rules)` runs every rule's optional `infer` hook over `text` and returns `StyleEvidence` — a monoid (`StyleEvidence.empty` / `StyleEvidence.combine`) so multi-file evidence merges with an `observe`-per-file, `combine`, resolve loop.
  - `YamlLint.resolveStrict(evidence, base?)` overlays unanimous picks onto `base` (default `YamlLintConfig.default`), failing with the new `YamlStyleConflictError` when an observed dimension disagrees across the corpus. Unobserved dimensions fall back to `base`, and an explicit `"off"` in `base` always outranks inference.
  - `YamlLint.resolveLenient(evidence, base?)` picks the dominant (plurality) spelling per observed dimension and cannot fail.
  - `YamlLint.inferStrict(text, rules, base?)` and `YamlLint.inferLenient(text, rules, base?)` are single-text conveniences combining `observe` and the matching resolver; `inferLenient` also returns `residual` — the diagnostics the inferred config still produces against `text`.

  ```ts
  import { YamlLint } from "@effected/yaml";

  const evidence = YamlLint.observe(text, YamlLint.builtins);
  const result = YamlLint.resolveStrict(evidence);
  // Result.Result<YamlLintConfig, YamlStyleConflictError>
  ```
  Custom rules opt into inference by implementing the new optional `infer` hook on `YamlRule`, yielding `StyleVote` or `StyleFloor` observations. Rules with no detectable style (`truthy`, `key-duplicates`, `line-length`, …) stay default-driven. [#476][#476]

* Added an opt-in `requoteScalars` option to `YamlFormattingOptions`, read by `YamlFormat.format` / `YamlFormat.formatToString`. By default, formatting preserves an already-quoted scalar's own quote style and `quoteStyle` only governs quotes the stringifier introduces. Setting `requoteScalars: true` makes `quoteStyle` apply to scalars already quoted in the source, but only when the re-quote provably preserves the parsed value: single→double applies proper double-quote escaping, and double→single is skipped whenever the value carries characters single-quoted style cannot express (newlines, tabs, control and other non-printable characters). Plain scalars, block scalars, and scalars carrying a tag, anchor, or spanning multiple source lines are left untouched.
  ```ts
  import { YamlFormat, YamlFormattingOptions } from "@effected/yaml";

  const options = YamlFormattingOptions.make({ quoteStyle: "double", requoteScalars: true });
  const formatted = YamlFormat.formatToString("key: 'value'\n", undefined, options);
  // key: "value"
  ```
  The option is deliberately absent from `Yaml.stringify` (which serializes plain values) and `YamlFormat.modify` (which takes a bare `YamlStringifyOptions`) — it only applies where a source quote exists to re-quote. [#476][#476]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#476]: https://github.com/spencerbeggs/effected/pull/476

## 0.10.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.9.0

### Breaking Changes

- ### Comments moved from `YamlPair` onto the key and value nodes
  `YamlPair` no longer carries `commentBefore`, `comment` or `spaceBefore` — it is `key` and `value`, nothing else. Every other node class (`YamlScalar`, `YamlMap`, `YamlSeq`, `YamlAlias`) carries the full triple. Code that read `pair.comment` must now read it off `pair.key` or `pair.value`:
  ```ts
  // before
  const trailing = pair.comment;

  // after
  const trailing = pair.value?.comment ?? pair.key.comment;
  ```
  `YamlAlias` gaining the triple is also a fix: alias comments were previously dropped entirely, both on capture and on emission, and now round-trip.

  Attribution follows one rule: an own-line comment above an entry leads that entry's **key** node; a trailing comment belongs to the last node on its line — the value when the value ends the line (`a: 1 # t`), the key when the value renders below it (`push: # only main`).
  ### `YamlDocument` comment fields renamed
  - `comment` (the leading header block) is now `commentBefore`
  - `commentAfter` (the trailing block) is now `comment`

  These now match the names the node classes use. Attribution is marker-aware: `commentBefore` is a header sitting ahead of a `---` marker; a header after the marker leads the root node; a header with no marker leads the first entry's key.

### Bug Fixes

- A document-root block scalar's header comment (`| # note`) had no emission path and was silently dropped on format — now emitted across the bare, `---`, and tag/anchor spellings (#349)
- The explicit-key branch of the block-mapping stringifier never emitted the value's own leading comment, losing it on a single format pass (#348)
- A mapping whose last pair had a null value swallowed the terminal comment while looking for a value that wasn't there, on ordinary YAML like `x:\n# c\n` (#348)
- A flow collection whose closing bracket sits at column 0 (`x: {\n  a: 1\n}`) was rejected; a closing bracket is not content and the spec sets no indentation floor on it (#340)
- A document header comment above a `---` marker was stored as the document's *trailing* comment, so every format pass relocated it below the marker. Headers on both sides of a marker were merged into one block and emitted above it; each now keeps its own side
- An entry carrying trailing comments on both its key and its value below (`a: # kc` / `   1 # vc `) emitted only the key's, hoisting the value onto the key's line and dropping its comment
- An inline flow collection carrying a trailing comment (`a: {b: 1} # t`) was expanded into a multi-line flow with the comment moved inside the brackets. A comment after the closing bracket cannot swallow it, so only a comment *inside* forces that layout now
- A header comment over a scalar document root was dropped unless the document had a `---` marker; the emission slot was gated on the marker
- An after-marker comment was discarded when the document had no content and a pre-marker header already existed (`# a\n---\n# b\n` kept only `# a`)
- A blank line below an after-marker comment was attributed to the pre-marker block, moving it across the marker and never reaching a fixed point
- Under a value's leading comment block, the value's own trailing comment was printed on the key's line instead of its own (`a:\n  # lead\n  1 # vc`)
- A trailing comment on an alias key (`*x : # c`) collapsed onto the value's line; an alias key emits in implicit form, so it owns its line like any scalar key

Both `push: # only main` and an own-line comment above a value now round-trip byte-intact through a format pass. Previously the two source shapes collapsed to the same AST, so formatting one always rewrote it into the other. [#384][#384]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#384]: https://github.com/spencerbeggs/effected/pull/384

## 0.8.0

### Breaking Changes

- `comment` on `YamlScalar`, `YamlMap`, `YamlSeq` and `YamlPair` is now **strictly trailing** (same-line, after the node). It previously carried both leading (own-line) and trailing comments; leading comments now live on a new `commentBefore` field. A new `spaceBefore` boolean flags a blank line preceding the node (and its `commentBefore` block, when present). `YamlAlias` carries no comment fields.

  `YamlDocument` gains `commentAfter` for comments trailing the document's `...` end marker; the existing `comment` field keeps its prior meaning (the leading document header).

  `YamlVisitor`'s `Comment` event now carries a `placement: "leading" | "trailing"` field alongside `text`.

  Code that constructed nodes with `comment` expecting leading placement, or that read `comment` looking for an own-line comment, must switch to `commentBefore`:
  ```ts
  import { Effect } from "effect";
  import { YamlDocument, YamlMap } from "@effected/yaml";

  const program = Effect.gen(function* () {
  	const doc = yield* YamlDocument.parse("a: 1\n\n# section\nb: 2\n");
  	const map = doc.contents as YamlMap;
  	const [a, b] = map.items;

  	// Before: `b.comment` held " section" (own-line comment misfiled as trailing).
  	// After: own-line comments attach forward and live on `commentBefore`.
  	b?.commentBefore; // " section"
  	b?.comment; // undefined
  });
  ```

### Features

- ### Comment fidelity (\#127)
  `YamlFormat.formatToString` and `modify` now round-trip leading, trailing and own-line comments, plus the blank lines around them, byte-faithfully — raw post-`#` text, alignment and no-space comment styles are all preserved. Own-line comments attach forward to the following node; a comment left dangling at the end of a scope escapes to the enclosing one. This is controlled by the existing `preserveComments` option: `true` (the default) gives full round-trip fidelity, `false` strips every comment. Canonical output (`forceDefaultStyles`) stays comment-free as before. Six deliberate divergences from the reference `yaml` package are recorded at the head of `src/internal/composer/comments.ts`.
  ### Lint system (\#129)
  A new yamllint-class lint engine, plus a public token stream it's built on:
  ```ts
  import { YamlLint, YamlLintConfig, YamlTokens } from "@effected/yaml";

  // Positioned lexical tokens — a sync `Result` primitive that always
  // succeeds; lexical errors surface as `"error"`-kind tokens in the array
  // so malformed input is still lintable. `YamlTokens.stream` is the derived
  // `Stream` form for incremental consumers.
  const tokens = YamlTokens.tokenize("a: 1\n");

  // Run the built-in catalog (or your own rules, concatenated onto it) under
  // a preset config.
  const diagnostics = YamlLint.run(text, YamlLint.builtins, YamlLintConfig.default);

  // Apply every non-overlapping fix. Fails with `YamlParseError` when the
  // input has a fatal parse error; otherwise surgical and comment-safe —
  // it never reformats, only ever applies edits through `YamlEdit.applyAll`.
  const fixed = YamlLint.fix(text, YamlLint.builtins, YamlLintConfig.default);
  ```
  14 built-in rules ship: `parse-validity` (always-on, cannot be disabled or demoted), `line-length`, `trailing-spaces`, `empty-lines`, `eof-newline`, `document-start`, `document-end`, `key-duplicates`, `quoted-strings`, `truthy`, `comments-spacing`, `colon-spacing`, `hyphen-spacing` and `indentation` (style-only — reports but does not fix). Two presets ship as statics — `YamlLintConfig.default` and `YamlLintConfig.relaxed` (style rules demoted to warnings) — and config validation is rule-aware: an unknown option key or an out-of-range numeric option on a built-in rule fails with a typed error naming the rule and the field, rather than silently decoding to `{}`.
  ### Whole-stream validation (`Yaml.parseAllResult`)
  The sync `Result` twin of `Yaml.parseAll`: fails typed with `YamlParseError` when **any** document in the stream carries a fatal diagnostic, making it a whole-stream validity check — a `Success` means every document parsed clean.
  ```ts
  import { Yaml } from "@effected/yaml";
  import { Result } from "effect";

  const result = Yaml.parseAllResult("a: 1\n---\nb: 2\n");
  if (Result.isSuccess(result)) {
  	result.success; // [{ a: 1 }, { b: 2 }]
  }
  ```
  Empty input parses as one empty document: `Yaml.parseAllResult("")` succeeds with `[null]`, matching `Yaml.parse("")` → `null`.
  ### Multi-document format support
  `YamlFormat.format`/`formatToString` now format every document of a `---`-separated stream, re-emitting each document's own framing (`---`, `...`, comment blocks) in order — previously a multi-document stream silently truncated to its first document on write-back, a data-loss bug on write. Two shapes still return the input byte-identical because they cannot be re-emitted faithfully: a stream with any fatally-invalid document, and directive-carrying input (see Bug Fixes below). `modify`/`modifyToString` stay single-document and now fail typed with a new `MultiDocumentStream` diagnostic — a `YamlPath` names no particular document of a stream.

  A comment between a `---` marker and the first content node hoists above the marker on the first format pass — the existing single-document behavior, inherited by the stream path. Blank lines, meaning, and the fixed point from the second pass on are all preserved; the output is not byte-identical to the input for that specific shape.
  ### Block-scalar header comments (\#341)
  A trailing comment on a block-scalar header (`key: | # c`, `key: > # c`, `- | # c`, `- > # c`, every chomp/indicator spelling, and the explicit-key branch) now captures and re-emits byte-faithfully, closing the last recorded comment-fidelity divergence from #127. Explicit chomp (`|+`) and indentation (`|2`) indicators are preserved on the fidelity path too, carried by a new optional `blockIndent` field on `YamlScalar` (additive); when a pair comment and a scalar header comment coexist, the pair comment keeps the key line and the header spills to its own indented line so both survive.

### Bug Fixes

- Block-mapping keys whose rendered form exceeds 1024 characters now spill to explicit-key form (`? key` / `: value`) in both stringify paths, so spec-strict parsers accept the output (YAML 1.2 §8.1.3) — pnpm 11 lockfile snapshot keys were the driving case (#323).
- Compact continuation lines under an explicit key now pad a structural 2 columns regardless of the `indent` option, a deliberate divergence from the reference implementation (whose output fails its own strict reparse at an indent other than 2).
- A trailing comment on the last key of a nested block mapping made the parser swallow the following dedent — the next sibling was silently absorbed into the nested mapping and its value shredded, with `parseResult` reporting success throughout. Root cause was in the CST value loop's trivia consumption.
- An empty-valued key followed by a same-or-lesser-indented sibling absorbed the sibling as its own value (`key:\nother: 1` parsed to `{"key":"other","":1}` instead of `{"key":null,"other":1}`) (#339); the composer's pending-pair value consumption now refuses cross-line nodes that carry their own value separator.
- Chomp-indicator parsing read the whole block-scalar header line, so a `+`/`-` inside a header **comment** flipped keep/strip chomping and silently changed a document's semantics on re-emit.
- Blank-line fidelity: a blank line separating a leading comment block from the first key (the common `dependabot.yml`-style file-header convention), and a blank line before a block collection's terminal own-line comment run, are now preserved through format.
- `format`/`formatToString` previously dropped `%YAML`/`%TAG` directive lines while re-emitting the shorthand tags that depend on them, turning a valid document into one no parser can read; both now leave directive-carrying input byte-identical instead of corrupting it. `modify`/`modifyToString` fail typed with a new `DirectiveCarryingDocument` diagnostic. Directive re-emission is future work.
- A new 43-test oracle-differential suite, with expectations authored offline against `yaml@2.9.0` and `js-yaml`, guards the parser against the class of round-trip-blindness bug that hid the two parser issues above.

### Documentation

- README gained a "Migrating from Prettier" mapping table: `tabWidth` → `indent`, `singleQuote` → `quoteStyle`, indented block sequences → `indentSequences: true`; `printWidth`/`proseWrap` have no analog on the format path. [#338][#338]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#338]: https://github.com/spencerbeggs/effected/pull/338

## 0.7.0

### Bug Fixes

- Fixed parsing of block mappings that use explicit-key syntax (`? key` / `: value`) with a compact collection starting on the `:` line (YAML 1.2 `s-l+block-indented`). Previously the compact mapping's first key was consumed as a scalar value and the remainder became a phantom null-keyed entry, so two such entries failed with a spurious `DuplicateKey` — the shape pnpm 11 writes for lockfile snapshot keys longer than 1024 characters, which made real `pnpm-lock.yaml` files unparseable. Nested explicit entries also no longer swallow a following `?` key belonging to an ancestor mapping, and a genuine duplicate-null-key report now points at the offending `:` indicator instead of position 0:0.
- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `Yaml` and `YamlDocument`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.6.1

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.6.0

### Breaking Changes

- ### `YamlNode`'s recursive references are typed as codecs
  The recursive references in the node model were annotated as type-only schemas, which discarded the encoded side of the codec and made `YamlNode` the odd one out against the `@effected/toml` and `@effected/markdown` node models.

  They are now codecs carrying both sides. The exported `YamlNode` value's type changes accordingly, so an explicit annotation naming the old form no longer matches:
  ```ts
  // before
  const node: Schema.Schema<YamlScalar | YamlMap | YamlSeq | YamlAlias> = YamlNode;

  // after
  const node: typeof YamlNode = YamlNode;
  ```
  Code that consumes `Yaml.parse`, `YamlFormat` or the node classes without annotating the schema value itself is unaffected.

### Features

- `YamlScalarEncoded`, `YamlMapEncoded`, `YamlSeqEncoded` and `YamlAliasEncoded` are exported — the encoded companions of the four node classes, usable wherever the encoded side needs naming [#175][#175]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#175]: https://github.com/spencerbeggs/effected/pull/175

## 0.5.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.5.0

### Features

- ### `quoteStyle`: choose the fallback quote character for plain scalars
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

- ### Carriage returns and interior tabs are no longer emitted as plain scalars
  `Yaml.stringify` emitted a string containing a carriage return or an interior tab as an unquoted plain scalar. The carriage-return case was silent data corruption: `stringify` produced `cr: has<CR>carriage`, and parsing that back returned `has carriage` — the carriage return normalised to a space, with no error raised on either leg. The tab case round-tripped through this package but produced text other YAML parsers reject outright, `yaml` (via Prettier) reporting `MULTILINE_IMPLICIT_KEY — Implicit keys need to be on a single line`.

  The quoting gate tested only `isControlChar`, which deliberately excludes tab (`0x09`) and carriage return (`0x0D`) because the block-scalar and single-quoted-multiline paths can represent both. A leading or trailing tab was already caught by a separate whitespace check, leaving the interior tab and every carriage return unquoted. Both are now tested explicitly at that gate, so such values take the double-quoted fallback and round-trip exactly. Only single-line values reach the gate, so multi-line strings containing tabs still use block scalars as before.

  Values containing NUL, bell, escape and the other C0 control characters were already quoted correctly and are unchanged; they now have regression coverage alongside the two fixed cases. The yaml-test-suite conformance harness stays at 1226/1226.
  ### The merge key is no longer quoted on re-emission
  `YamlFormat.format` / `.formatToString` and `YamlDocument#stringify` rewrote a plain `<<` mapping key as `'<<'`. A plain `<<` resolves to `tag:yaml.org,2002:merge` and splices the aliased mapping into its parent; `'<<'` is an ordinary string key that merges nothing. Formatting a document therefore changed what it meant, with no error raised — the output still parsed and still round-tripped, which is why nothing caught it. Merge keys are common in Docker Compose, GitLab CI and Kubernetes manifests, so a format-on-save over a repository of such files silently broke every one of them.

  `<<` was reaching the "leading indicator character" branch of the plain-scalar quoting gate. The fix is a carve-out at the mapping-key boundary rather than a relaxation of that gate: a key that is a plain-styled scalar with no tag and no anchor, whose value is exactly `<<`, is emitted plain. Both the block and the flow mapping branches route through one helper, so the two cannot disagree.

  The carve-out is deliberately narrow, and reads the key's source style:
  - An explicitly quoted `'<<'` or `"<<"` key keeps its quotes — the author wrote a literal string key, and that is preserved.
  - `<<` in **value** position is untouched. Plain and quoted resolve to the same string there, so no semantics ride on it.
  - The **value path** (`Yaml.stringify` over a plain JS object) still quotes a `"<<"` key. That direction is the mirror image: a JS key `"<<"` carries no merge intent, so emitting it plain would *create* merge semantics the input never had.

  This was pre-existing on the `0.4.0` line, not a consequence of the `quoteStyle` work above — verified by running the repro through the pre-change sources, which produce byte-identical output. The yaml-test-suite corpus contains no merge-key fixtures at all (merge is a YAML 1.1 type-repository feature, outside YAML 1.2 core), so conformance was structurally incapable of catching this; coverage is added directly instead. Conformance stays at 1226/1226. [#125][#125]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.4.0

### Breaking Changes

- ### `YamlEdit.applyAll` rejects overlapping edits
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

- ### `Yaml.bind(target)`
  Added `Yaml.bind`, which composes `Yaml.schema(target)` once and hands back
  a `YamlBoundCodec` carrying that `schema` plus `decode` and `encode`&#10;functions already derived from it. Call sites stop reaching for&#10;`Schema.decodeEffect` / `Schema.encodeEffect` around a domain schema every
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
  Both directions fail with `Schema.SchemaError`, exactly as&#10;`Schema.decodeEffect` / `Schema.encodeEffect` over `Yaml.schema` do, and the
  target's decoding and encoding service requirements flow through to `RD` and&#10;`RE`.

  `bind` covers the plain single-document form only — default parse options on
  the way in, default stringify options on the way out. Multi-document streams
  stay on `Yaml.allFromString`, composed directly.

  Like the other schema factories, `bind` is schema-producing: each call
  composes a fresh schema and derives a fresh pair of directions. Bind the
  result to a `const` and reuse it — that single binding is the point. [#122][#122]

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.3.1

### Documentation

- Clarify that `lineWidth` scalar folding is a value-path-only feature:&#10;`Yaml.stringify`/`Yaml.stringifySync` honor it, while `YamlDocument#stringify`&#10;and the `YamlFormat` helpers accept the option but never fold — callers
  needing folded output on that path should render the plain value instead
  (`Yaml.stringify(doc.toValue(), options)`).
- Fixed two `{@link Result}` cross-package references that produced&#10;`ae-unresolved-link` warnings in the production build; the package now
  builds warning-free. [#112][#112]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#112]: https://github.com/spencerbeggs/effected/pull/112

## 0.3.0

### Features

- `Yaml.parseSync` and `Yaml.stringifySync` — synchronous escape hatches returning a `Result` instead of an `Effect`, for config-time callers that cannot `await` (a `vitest.config.ts` is the motivating case). They run the same engine as the Effect variants and honor the package contract: malformed or adversarial input (fatal diagnostics, duplicate keys, a "billion laughs" alias-expansion blow-up, a circular reference, or a value nested past the recursion budget) yields a `Failure` carrying the typed `YamlParseError` / `YamlStringifyError` — never a thrown defect.

  `YamlStringifyOptions.lineWidth` now performs real column-based scalar folding. A positive value folds long plain, double-quoted and block-folded (`>`) scalars at approximately that column, inserting only semantically transparent line breaks (round-trip is preserved); block-literal (`|`) content is never folded.
  - `parseSync(text, options?): Result<unknown, YamlParseError>`
  - `stringifySync(value, options?): Result<string, YamlStringifyError>`

  ### lineWidth default is now 0 (never wrap)
  `lineWidth` previously had no effect — it was threaded into the stringifier but never read, so output never wrapped. Its default changes from `80` to `0`, where `0` (and any value `<= 0`) means never wrap. Output for the default path, and for anyone already passing `lineWidth: 0`, is byte-identical to before. A caller passing a positive `lineWidth` now opts into folding, where previously the value was inert. [#106][#106]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.2.0

### Features

- ### `indentSequences` formatting option
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

- Zero-dependency YAML 1.2 parsing, editing and formatting expressed as Effect schemas and pure functions. Parse a single document or a multi-document stream into plain values or an offset-preserving AST, resolve anchors and aliases, strip comments, compute byte-minimal edits, format, modify by path, walk a document as a `Stream`, and decode straight into a validated domain schema. The lexer, CST parser, composer and stringifier are vendored into the package with attribution — `effect` is the only runtime dependency.
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
