# @effected/markdown

## 0.7.0

### Features

#### MDX node vocabulary

- Adds a construct-and-serialize-only MDX node set — eight new node classes shaped exactly to the `mdast-util-mdx-jsx`, `mdast-util-mdx-expression` and `mdast-util-mdxjs-esm` contracts: `MdxJsxFlowElement`, `MdxJsxTextElement`, `MdxJsxAttribute`, `MdxJsxExpressionAttribute`, `MdxJsxAttributeValueExpression`, `MdxFlowExpression`, `MdxTextExpression` and `MdxjsEsm`. The parser still reads no MDX syntax — these exist so a hand-built or programmatically constructed tree can carry MDX content and round-trip through `Markdown.stringify`:

```ts
import { Markdown, MdxJsxFlowElement, MdxJsxAttribute } from "@effected/markdown";

const tree = MdxJsxFlowElement.make({
	name: "Alert",
	attributes: [MdxJsxAttribute.make({ name: "level", value: "warning" })],
	children: [],
});
```

- Serialization matches the mdast-util-mdx oracles byte for byte, and escaping is keyed on MDX-node presence rather than an option: a tree with no MDX nodes still serializes byte-identical to the documented canonical form.

#### Phrasing-only parsing

- `Markdown.parsePhrasingResult` (sync `Result`) and `Markdown.parsePhrasing` (`Effect`) parse a text fragment as a single paragraph's inline content — useful when a caller only has a prose fragment, not a whole document:

```ts
import { Markdown } from "@effected/markdown";
import { Result } from "effect";

const ok = Markdown.parsePhrasingResult("see [the docs](./docs.md)");
if (Result.isSuccess(ok)) {
	console.log(ok.success.map((node) => node.type)); // => ["text", "link"]
}
```

#### String-level frontmatter split and join

- `FrontmatterSource.split` and `FrontmatterSource.join` handle a document's frontmatter fence at the raw-string level, without parsing the body at all — for callers who need byte-exact boundaries (e.g. a content hash over the body) or whose body isn't CommonMark: [#517][#517]

```ts
import { FrontmatterSource } from "@effected/markdown";

const split = FrontmatterSource.split("---\ntitle: hi\n---\n\n# Body\n");
console.log(split.frontmatter?.format); // => "yaml"
console.log(split.body); // => "\n# Body\n"
```

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/yaml | dependency | updated | 0.11.0 | 0.12.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#517]: https://github.com/spencerbeggs/effected/pull/517

## 0.6.3

### Documentation

- `Markdown.stringify` and `Markdown.stringifyResult` now state that the canonical form is a **stability commitment**: there are no options to configure, the output is pinned by byte-level tests, the engine is cross-checked against commonmark.js over the full CommonMark 0.31.2 corpus, and changing any canonical choice is a breaking change rather than a patch.

  A test may therefore assert on these bytes, and a pipeline needing stable rendered markdown should serialize through here rather than through a third-party stringifier whose defaults are free to move between releases.

  Two cases the table calls out explicitly, because both surprise a consumer asserting bytes. **Representability wins over the table**: an indented code block directly after a list would be absorbed as list content, so a `Code` node with neither `lang` nor `fenceChar` emits fenced in that position and indented everywhere else. And **fidelity fields must be set on the decoded tree** — `Mdast.fromMdast` admits spec mdast and strips everything else, so a `fenceChar` placed on a plain mdast tree before admission is silently dropped.

  The canonical choices a byte-level assertion depends on — heading style, thematic break, bullet and ordered-list markers, emphasis, code-block style and fence growth, block separation, trailing newline — are published as a table on `Markdown.stringifyResult` and in the README, so a consumer need not read the test suite to know what they are asserting against. A node carrying a fidelity field still overrides the matching row.

### Tests

- Added a "documented canonical form" suite asserting every row of the published table, so the promise and the implementation cannot drift
- Pinned the representability escape in both directions: indented alone and after a paragraph, fenced after a list, and the emitted text reparsing as a list plus a separate code node [#487][#487]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#487]: https://github.com/spencerbeggs/effected/pull/487

## 0.6.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.10.0 | 0.11.0 |

## 0.6.1

### Performance

- Reduced the work `MarkdownDocument.sections` performs when computing section boundaries by indexing root-level headings first and deriving boundaries from that index instead of rescanning non-heading root blocks for each section.
  - Output stays identical: section ranges, ordering, heading matching behavior, and body spans are unchanged. [#469][#469]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#469]: https://github.com/spencerbeggs/effected/pull/469

## 0.6.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/toml | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/yaml | dependency | updated | 0.9.0 | 0.10.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.5.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.8.0 | 0.9.0 |

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.7.0 | 0.8.0 |

## 0.5.0

### Bug Fixes

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.5.2 | 0.6.0 |
| @effected/toml | dependency | updated | 0.3.2 | 0.4.0 |
| @effected/yaml | dependency | updated | 0.6.1 | 0.7.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.4.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.5.1 | 0.5.2 |
| @effected/toml | dependency | updated | 0.3.1 | 0.3.2 |
| @effected/yaml | dependency | updated | 0.6.0 | 0.6.1 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.4.1

### Bug Fixes

- Cap link-destination parenthesis nesting at 32, matching the reference implementation's spec-sanctioned limit. The uncapped bare-destination scan was quadratic on pathological unclosed-link input — thirty thousand repetitions of an unclosed link took over five seconds to parse and now take thirty milliseconds — and the same input class could stall any consumer parsing untrusted markdown.

### Performance

- The `RowContent`, `TableContent` and `ListContent` categories are now real one-member unions, so table and list children pass through construction by identity instead of being deep re-constructed per element. Parsing the pathological tables corpus drops from 7.4 to 2.8 seconds, and consumers building large tables from pre-built rows no longer pay a per-element re-construction cost. [#215][#215]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215

## 0.4.0

### Breaking Changes

- `FrontmatterMissingError` gains a required `reason: "absent" | "captureDisabled"`&#10;field, exported as `FrontmatterMissingReason`. Any code constructing or
  pattern-matching on `new FrontmatterMissingError()` with no arguments now
  breaks at compile time.
  ```ts
  // Before
  new FrontmatterMissingError();

  // After
  new FrontmatterMissingError({ reason: "absent" });
  ```
  `reason` distinguishes why a frontmatter decoder found no capture:&#10;`"absent"` when the source genuinely has no frontmatter block, and&#10;`"captureDisabled"` when the source opens with a well-formed block but the
  document was parsed without `frontmatter: true` — the fix there is
  re-parsing with the toggle on, not editing the document.

### Features

- `MarkdownDocument.hasFrontmatterBlock` is a new derived getter: whether the
  source opens with a well-formed frontmatter block, regardless of how the
  document was parsed. It's what `FrontmatterMissingError`'s `reason` is
  computed from, so the error and the accessor can never disagree.
  ### `codeBlockStyle` formatting option
  `MarkdownFormattingOptions` gains `codeBlockStyle`, exported as&#10;`CodeBlockStyle` (`"fenced" | "indented"`), converting **language-less**&#10;code blocks between CommonMark's two spellings. It exists because the
  default surprises: a language-less `Code` node with no explicit `fenceChar`&#10;serializes as an indented block, not a fence.
  ```ts
  import { MarkdownFormat } from "@effected/markdown";

  const formatted = MarkdownFormat.formatToString(source, { codeBlockStyle: "fenced" });
  ```
  Absent, formatting behaves exactly as before. A block with a `lang` is never
  touched — it has no indented spelling. Both directions skip conversions that
  would change meaning on re-parse: container prefixes, lazy paragraph
  continuation, list or footnote absorption, merging with an adjacent code
  block, and unrepresentable content (empty, or blank first/last lines). [#191][#191]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.3.0

### Features

- Added `DocumentSection`, a navigation projection over a parsed document's
  root-level headings, with `MarkdownDocument.firstSection` and&#10;`.sectionByHeading` finder methods. A section's `bodyRange` spans from the end
  of its heading to the end of its (sub)section content, so the range can be
  handed straight to the edit layer to splice a whole section. Heading-text
  matching against `sectionByHeading` is exact against trimmed text, never a
  substring match, so `"1.2.3"` cannot accidentally match a `## 1.2.30` heading. [#180][#180]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.2.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/yaml | dependency | updated | 0.5.1 | 0.6.0 |

## 0.2.4

### Bug Fixes

- The upstream defect this package filed as [Effect-TS/effect#6491](https://github.com/Effect-TS/effect/issues/6491) is fixed in `effect@4.0.0-beta.101`, so a plain-object `position` literal is accepted by `make` again and promoted to real `Position` / `Point` instances:
  ```ts
  Frontmatter.make({
    type: "frontmatter",
    format: "yaml",
    value: "a: 1",
    position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 3, column: 4, offset: 12 } },
  });
  ```
  Through `beta.99` that threw, because `SchemaParser.recurDefaults` *replaced* the field's class-construction link with the default link rather than appending to it — while the type level still admitted the literal. No change was needed in this package; the tripwire test pinning the old behavior fired on the advance and is retired.

### Documentation

- The known-limitation notes in the package context file and design doc are replaced with the resolution, plus the re-construction consequence and the rule that positions are never asserted by identity [#162][#162]

### Tests

- The same fix means a nested class field's construction link now always runs, so `make` **re-constructs** a nested class value instead of passing it through by reference — `Text.make({ position: p }).position !== p`, structurally equal but a distinct instance. This holds for an explicit position and for the `Position.synthetic` default alike, and for fields with no constructor default at all, so it is `make`'s nested-field semantics rather than anything about the default.

  `Position` is an immutable value class with structural equality, so identity was never the contract worth pinning:
  - Synthesized-position tests now assert by value (`deepStrictEqual`) instead of by reference
  - The explicit-position test additionally asserts the default did **not** win, which is the behavior it was really guarding

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.5.0 | 0.5.1 |
| @effected/toml | dependency | updated | 0.3.0 | 0.3.1 |
| @effected/yaml | dependency | updated | 0.5.0 | 0.5.1 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.2.3

### Bug Fixes

- ### Internal @effected edges float patches instead of pinning exact versions
  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.2.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.4.0 | 0.5.0 |

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/toml | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/yaml | dependency | updated | 0.4.0 | 0.5.0 |

## 0.2.0

### Features

- ### New package: CommonMark and GFM markdown as Effect schemas
  `@effected/markdown` parses, edits and transforms markdown as pure Effect schemas over a vendored, hardened port of commonmark.js — the reference parser maintained by the spec author — restructured as one module per construct behind dialect-keyed registries. There is no runtime parser dependency and no plugin surface: `commonmark` and `gfm` are the two dialects, `gfm` is the default, and both are pinned by the upstream conformance corpora. Parse is near-total, because CommonMark has no syntax errors — the typed error channel carries hardening-guard trips only, never "malformed markdown".

  Nodes are shaped to mdast's exact type names and field shapes, and every node carries byte offsets alongside unist line/column positions, so an edit is a splice against the original source rather than a re-serialization of a tree.
  ```ts
  import { MarkdownDocument } from "@effected/markdown";
  import { Effect } from "effect";

  const source = `# Release notes

  ## Fixed

  - Tables no longer ~~drop~~ trailing cells.
  `;

  const program = Effect.gen(function* () {
  	const doc = yield* MarkdownDocument.parse(source);
  	return doc.headings.map((heading) => `${"#".repeat(heading.depth)} ${heading.text}`);
  });

  Effect.runPromise(program).then(console.log);
  // [ "# Release notes", "## Fixed" ]
  ```
  The strikethrough parses as a `delete` node with no configuration, since the dialect defaults to `gfm`. Every parse has a synchronous twin — `MarkdownDocument.parseResult` and `Markdown.parseResult` return a `Result` — so a build script, a Vite plugin or a language-server tick can call in without an Effect runtime.
  ### Editing by node identity, without reformatting the document
  `MarkdownFormat.modify` computes a `MarkdownEdit` array against the parsed document and `modifyToString` applies it in one step. The target is a node from the document's own tree, matched by identity, and everything the edit does not cover survives byte-for-byte — blank lines, HTML comments and hand-tuned spacing all come through unchanged.
  ```ts
  import { MarkdownDocument, MarkdownFormat } from "@effected/markdown";
  import { Effect } from "effect";

  const source = `# Release notes

  See the [changelog](./CHANGELOG.md).
  `;

  const program = Effect.gen(function* () {
  	const doc = yield* MarkdownDocument.parse(source);
  	const label = doc.find("text")!;
  	return yield* MarkdownFormat.modifyToString(doc, label, "Release notes (2026)");
  });

  Effect.runPromise(program).then(console.log);
  // # Release notes (2026)
  //
  // See the [changelog](./CHANGELOG.md).
  ```
  `find` and `findAll` walk the tree in document pre-order and narrow on a string selector — `doc.findAll("heading")` is `ReadonlyArray<Heading>` and `doc.find("table")` is `Table | undefined` — or on a type-guard predicate. Nodes come back by identity, so a query result feeds `modify` directly without raw child indexing. Replacements are literal strings or node fragments and both render through the canonical stringifier, so a modified document re-parses cleanly by construction.

  `MarkdownFormat.format` handles conservative marker normalization — heading style, bullet character, emphasis marker, fence character, thematic-break character — and skips any conversion that would not be safe rather than attempting it cleverly. It is pure and total, and its edits are non-mutating data you can hand to `MarkdownEdit.applyAll` or send to an editor as a text-edit payload. `MarkdownEdit` and `MarkdownRange` are field-identical to `@effected/jsonc`'s, `@effected/yaml`'s and `@effected/toml`'s, so the same editing vocabulary spans every format in the kit.

  Node classes default `position` to a zero-width synthetic sentinel (`Position.synthetic`), so a replacement fragment constructs in one line — `Text.make({ value: "shipped" })`.
  ### Typed frontmatter, decoded and written back
  Frontmatter capture is opt-in, because enabling it changes how a document opening with `---` parses. Turn it on and compose your schema with a codec for typed gray-matter parity; `MarkdownFrontmatter.set` and `setToString` do the same trip in reverse, encoding typed data back into the block as a single offset-splice edit.
  ```ts
  import { MarkdownDocument, MarkdownFrontmatter, MarkdownParseOptions, YamlFrontmatter } from "@effected/markdown";
  import { Effect, Schema } from "effect";

  const source = `---
  title: Release notes
  draft: true
  ---

  # Release notes
  `;

  const Post = Schema.Struct({ title: Schema.String, draft: Schema.Boolean });

  const program = Effect.gen(function* () {
  	const options = MarkdownParseOptions.make({ frontmatter: true });
  	const doc = yield* MarkdownDocument.parse(source, options);
  	const data = yield* MarkdownFrontmatter.schema(Post, YamlFrontmatter)(doc);
  	return yield* MarkdownFrontmatter.setToString(Post, YamlFrontmatter)(doc, { ...data, draft: false });
  });

  Effect.runPromise(program).then(console.log);
  // ---
  // title: Release notes
  // draft: false
  // ---
  //
  // # Release notes
  ```
  Each stage fails typed and separately: no capture is a `FrontmatterMissingError` (catch the tag for optional semantics), a codec handed the wrong fence is a `FrontmatterFormatMismatchError`, unparseable content is a `FrontmatterDecodeError` carrying the format package's own positioned failure structurally, and schema-invalid data is a `FrontmatterValidationError` carrying the structured issue tree rather than a stringified rendering. A write never switches fences — handing a yaml codec a toml block fails rather than converting it.

  The three codecs — `YamlFrontmatter` (`---`), `TomlFrontmatter` (`+++`) and `JsonFrontmatter` (`---json`) — are free-standing named exports, one module each, deliberately never collected into a namespace object. Naming one codec is what pulls in its format engine, so a JSON-frontmatter consumer never pays for the yaml parser. Each peers optionally on its format package.

  Frontmatter blocks can also declare their own schema. `SchemaResolver.classify` sorts a `$schema` value into a tagged union — `ByUrl`, `ByPath`, `Inline` and `ByName` — and `SchemaResolver.fromRegistry` resolves `ByName` declarations like `skill@2.1.0` against schemas you register. URLs, paths and inline documents are carried as data and never fetched: this is a pure package and it performs no IO.
  ### Navigation, streaming walks and mdast interop
  `MarkdownDocument` derives `headings`, `sections` and `links` from the tree, so they can never disagree with it. `headings` lists every heading wherever it sits, including inside blockquotes and list items; `sections` are delimited by root-level headings only, and each section's range spans its subsections, so the edit layer can splice a whole section out in one edit; `links` collects every URL-bearing node and passes `url` through exactly as written, never normalizing a bundle-relative href.

  `MarkdownVisitor.visit` streams the same walk as a lazy `Stream` of `Enter`/`Exit` events carrying the node, its child-index path and its depth. `Mdast.toMdast` strips the fidelity fields this package adds and emits plain spec-valid mdast JSON the remark ecosystem consumes directly; `Mdast.fromMdast` goes the other way as a checked admission boundary, validating a foreign tree and synthesizing zero-width sentinel positions where one is absent or incomplete.
  ### Conformance
  All 652 CommonMark 0.31.2 spec examples run with an empty skip map, and the whole corpus runs again under both dialects with an explicitly asserted divergence list. The GFM extension corpora from cmark-gfm run complete, as does the 27-fixture `mdast-util-from-markdown` corpus, which asserts AST **and** position equality through the `Mdast` projection rather than just matching rendered output. A differential property suite cross-checks the parser against the `commonmark` npm package, and cmark's pathological suite pins the linear-time guarantee with calibrated budgets. Recursive surfaces carry a 256-deep nesting cap, so a nesting bomb fails through the typed error channel instead of overflowing the stack. Every oracle and corpus is devDependency-only; none reaches your runtime. [#122][#122]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/toml | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/yaml | dependency | updated | 0.3.1 | 0.4.0 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | @effected/jsonc | peerDependency | added | — | 0.3.0 |  |
  | @effected/toml | peerDependency | added | — | 0.1.0 |  |
  | @effected/yaml | peerDependency | added | — | 0.3.1 |  |
  | effect | peerDependency | added | — | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#122]: https://github.com/spencerbeggs/effected/pull/122
