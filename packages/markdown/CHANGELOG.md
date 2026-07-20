# @effected/markdown

## 0.2.2

### Dependencies

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.4.0 | 0.5.0 |

## 0.2.1

### Dependencies

| Dependency     | Type       | Action  | From  | To    |
| -------------- | ---------- | ------- | ----- | ----- |
| @effected/toml | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/yaml | dependency | updated | 0.4.0 | 0.5.0 |

## 0.2.0

### Features

* ### New package: CommonMark and GFM markdown as Effect schemas

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

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/toml  | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/yaml  | dependency | updated | 0.3.1 | 0.4.0 |

* | Dependency      | Type           | Action | From | To            |                                                                       |
  | --------------- | -------------- | ------ | ---- | ------------- | --------------------------------------------------------------------- |
  | @effected/jsonc | peerDependency | added  | —    | 0.3.0         |                                                                       |
  | @effected/toml  | peerDependency | added  | —    | 0.1.0         |                                                                       |
  | @effected/yaml  | peerDependency | added  | —    | 0.3.1         |                                                                       |
  | effect          | peerDependency | added  | —    | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#122]: https://github.com/spencerbeggs/effected/pull/122
