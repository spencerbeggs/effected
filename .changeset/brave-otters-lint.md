---
"@effected/yaml": minor
---

## Breaking Changes

`comment` on `YamlScalar`, `YamlMap`, `YamlSeq` and `YamlPair` is now **strictly trailing** (same-line, after the node). It previously carried both leading (own-line) and trailing comments; leading comments now live on a new `commentBefore` field. A new `spaceBefore` boolean flags a blank line preceding the node (and its `commentBefore` block, when present). `YamlAlias` carries no comment fields.

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

## Features

### Comment fidelity (#127)

`YamlFormat.formatToString` and `modify` now round-trip leading, trailing and own-line comments, plus the blank lines around them, byte-faithfully — raw post-`#` text, alignment and no-space comment styles are all preserved. Own-line comments attach forward to the following node; a comment left dangling at the end of a scope escapes to the enclosing one. This is controlled by the existing `preserveComments` option: `true` (the default) gives full round-trip fidelity, `false` strips every comment. Canonical output (`forceDefaultStyles`) stays comment-free as before. Six deliberate divergences from the reference `yaml` package are recorded at the head of `src/internal/composer/comments.ts`.

### Lint system (#129)

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

### Block-scalar header comments (#341)

A trailing comment on a block-scalar header (`key: | # c`, `key: > # c`, `- | # c`, `- > # c`, every chomp/indicator spelling, and the explicit-key branch) now captures and re-emits byte-faithfully, closing the last recorded comment-fidelity divergence from #127.

## Bug Fixes

- Block-mapping keys whose rendered form exceeds 1024 characters now spill to explicit-key form (`? key` / `: value`) in both stringify paths, so spec-strict parsers accept the output (YAML 1.2 §8.1.3) — pnpm 11 lockfile snapshot keys were the driving case (#323).
- Compact continuation lines under an explicit key now pad a structural 2 columns regardless of the `indent` option, a deliberate divergence from the reference implementation (whose output fails its own strict reparse at an indent other than 2).
- A trailing comment on the last key of a nested block mapping made the parser swallow the following dedent — the next sibling was silently absorbed into the nested mapping and its value shredded, with `parseResult` reporting success throughout. Root cause was in the CST value loop's trivia consumption.
- An empty-valued key followed by a same-or-lesser-indented sibling absorbed the sibling as its own value (`key:\nother: 1` parsed to `{"key":"other","":1}` instead of `{"key":null,"other":1}`) (#339); the composer's pending-pair value consumption now refuses cross-line nodes that carry their own value separator.
- Chomp-indicator parsing read the whole block-scalar header line, so a `+`/`-` inside a header **comment** flipped keep/strip chomping and silently changed a document's semantics on re-emit.
- Blank-line fidelity: a blank line separating a leading comment block from the first key (the common `dependabot.yml`-style file-header convention), and a blank line before a block collection's terminal own-line comment run, are now preserved through format.
- `format`/`formatToString` previously dropped `%YAML`/`%TAG` directive lines while re-emitting the shorthand tags that depend on them, turning a valid document into one no parser can read; both now leave directive-carrying input byte-identical instead of corrupting it. `modify`/`modifyToString` fail typed with a new `DirectiveCarryingDocument` diagnostic. Directive re-emission is future work.
- A new 43-test oracle-differential suite, with expectations authored offline against `yaml@2.9.0` and `js-yaml`, guards the parser against the class of round-trip-blindness bug that hid the two parser issues above.

## Documentation

- README gained a "Migrating from Prettier" mapping table: `tabWidth` → `indent`, `singleQuote` → `quoteStyle`, indented block sequences → `indentSequences: true`; `printWidth`/`proseWrap` have no analog on the format path.
