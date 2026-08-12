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

## Bug Fixes

- Block-mapping keys whose rendered form exceeds 1024 characters now spill to explicit-key form (`? key` / `: value`) in both stringify paths, so spec-strict parsers accept the output (YAML 1.2 §8.1.3) — pnpm 11 lockfile snapshot keys were the driving case (#323).
- Compact continuation lines under an explicit key now pad a structural 2 columns regardless of the `indent` option, a deliberate divergence from the reference implementation (whose output fails its own strict reparse at an indent other than 2).
