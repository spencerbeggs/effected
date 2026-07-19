# @effected/markdown

[![npm](https://img.shields.io/npm/v/@effected%2Fmarkdown?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/markdown)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Zero-dependency CommonMark 0.31.2 and GFM parsing, editing and transformation expressed as Effect schemas and pure functions. Parse markdown into mdast-shaped nodes carrying byte offsets, navigate headings, sections and links, compute surgical offset-splice edits, normalize markers, decode frontmatter into a validated domain schema, project to and from plain mdast for the remark ecosystem, and walk a document as a `Stream`.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/markdown

Markdown is where documentation, changelogs, knowledge bases and AI-agent context files actually live — files people edit by hand and expect to survive a tool touching them. The remark ecosystem is the JavaScript default, but its serializer reformats by design: read a document and write it back and you get remark's idea of markdown, not yours. Nobody in the ecosystem ships a lossless markdown CST, and the remark maintainers themselves point at positional splicing instead.

This package takes that advice as the architecture. Every node carries byte offsets alongside unist line/column positions, so an edit is a splice against the original source rather than a re-serialization of a tree: change a heading and the blank lines, HTML comments and hand-tuned spacing everywhere else come through byte-identical. `MarkdownEdit` is field-identical to `JsoncEdit`, `YamlEdit` and `TomlEdit`, so the same editing vocabulary spans every format in the kit.

The engine is a vendored, hardened port of commonmark.js — the reference parser maintained by the spec author — restructured as one module per construct behind dialect-keyed registries. That means no runtime parser dependency and no plugin surface to reason about: `commonmark` and `gfm` are the two dialects, `gfm` is the default, and both are pinned by the upstream conformance corpora. Parse is near-total, because CommonMark has no syntax errors: the typed error channel carries hardening-guard trips only, never "malformed markdown".

Nodes are shaped to mdast's exact type names and field shapes, so the tree is already the shape the remark ecosystem speaks, and `Mdast.toMdast` strips this package's fidelity fields to hand you plain spec-valid mdast JSON. Frontmatter — which mdast has no parsing story for at all — is captured behind a parse toggle and decoded through free-standing per-format codecs, giving typed gray-matter parity without dragging three format engines into a bundle that needs one.

Markdown to HTML is deliberately out of scope. This package parses, edits and transforms markdown; rendering belongs to whatever renderer you already have, reached through the mdast projection.

## Install

```bash
npm install @effected/markdown effect
```

```bash
pnpm add @effected/markdown effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency; the package itself adds no runtime dependencies.

`@effected/yaml`, `@effected/toml` and `@effected/jsonc` are **optional** peers, required only by the frontmatter codec module you import. A consumer decoding yaml frontmatter installs `@effected/yaml` and nothing else; a consumer who never touches frontmatter installs none of them.

```bash
npm install @effected/yaml
```

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Quick start

`MarkdownDocument.parse` gives you the source, the tree, the definition index and the navigation accessors in one value:

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

The dialect defaults to `gfm`, so the strikethrough above parses as a `delete` node with no configuration. Pass `MarkdownParseOptions.make({ dialect: "commonmark" })` for strict CommonMark.

Every parse has a synchronous twin — `MarkdownDocument.parseResult` and `Markdown.parseResult` return a `Result` — so a build script, a Vite plugin or a language-server tick can call in without an Effect runtime.

## Editing without reformatting the document

`MarkdownFormat.modify` computes a `MarkdownEdit` array against the parsed document; `modifyToString` applies it in one step. The target is a node from the document's own tree, matched by identity, and everything the edit does not cover survives byte-for-byte:

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

`find` walks the tree in document pre-order and returns the document's own node, so the match feeds `modify` by identity. Replacements are literal strings or node fragments, and both render through the canonical stringifier, so a modified document re-parses cleanly by construction — you cannot splice in raw markdown that reopens a fence or breaks a table.

`MarkdownFormat.format` handles the other half: conservative marker normalization, never content rewriting. It converts heading style, bullet character, emphasis marker, fence character and thematic-break character, and skips any conversion that would not be safe rather than attempting it cleverly:

```ts
import { MarkdownFormat, MarkdownFormattingOptions } from "@effected/markdown";

const source = `Setext heading
==============

* one
* two
`;

const options = MarkdownFormattingOptions.make({ headingStyle: "atx", bulletChar: "-" });

console.log(MarkdownFormat.formatToString(source, undefined, options));
// # Setext heading
//
// - one
// - two

console.log(MarkdownFormat.format(source, undefined, options));
// [
//   { offset: 0, length: 29, content: "# Setext heading" },
//   { offset: 31, length: 1, content: "-" },
//   { offset: 37, length: 1, content: "-" }
// ]
```

`format` is pure and total, and the edits are non-mutating data — hand them to `MarkdownEdit.applyAll`, or send them to an editor as a text-edit payload.

## Frontmatter

Frontmatter capture is opt-in, because enabling it changes how a document opening with `---` parses: CommonMark reads `---\ntitle: x\n---` as a thematic break and a setext heading, and that spec-conformant reading holds unless you ask for something else. Turn it on and compose your schema with a codec for typed gray-matter parity:

```ts
import { MarkdownDocument, MarkdownFrontmatter, MarkdownParseOptions, YamlFrontmatter } from "@effected/markdown";
import { Effect, Schema } from "effect";

const source = `---
title: Release notes
draft: false
---

# Release notes
`;

const Post = Schema.Struct({ title: Schema.String, draft: Schema.Boolean });
const decodePost = MarkdownFrontmatter.schema(Post, YamlFrontmatter);

const program = Effect.gen(function* () {
  const doc = yield* MarkdownDocument.parse(source, MarkdownParseOptions.make({ frontmatter: true }));
  return yield* decodePost(doc);
});

Effect.runPromise(program).then(console.log);
// { title: "Release notes", draft: false }
```

Each stage fails typed and separately: no capture is a `FrontmatterMissingError` (catch the tag for optional semantics), a codec handed the wrong fence is a `FrontmatterFormatMismatchError`, unparseable content is a `FrontmatterDecodeError` carrying the format package's own positioned failure structurally, and schema-invalid data is a `FrontmatterValidationError` carrying the structured issue tree rather than a stringified rendering.

The three codecs — `YamlFrontmatter` (`---`), `TomlFrontmatter` (`+++`) and `JsonFrontmatter` (`---json`) — are free-standing named exports, one module each, deliberately never collected into a namespace object. Naming one codec is what pulls in its format engine, so a JSON-frontmatter consumer never pays for the yaml parser.

Frontmatter blocks can also describe their own schema. `SchemaResolver.classify` sorts a `$schema` value into a tagged union — `ByUrl`, `ByPath`, `Inline` and `ByName` — and `SchemaResolver.fromRegistry` resolves `ByName` declarations like `skill@2.1.0` against schemas you register. URLs, paths and inline documents are carried as data and never fetched: this is a pure package and it performs no IO.

## Working with the tree

`MarkdownDocument` derives its navigation accessors from the tree, so they can never disagree with it. `links` collects every URL-bearing node and passes `url` through exactly as written — bundle-relative hrefs are never normalized:

```ts
import { MarkdownDocument } from "@effected/markdown";
import { Effect } from "effect";

const source = `# Release notes

See the [changelog](./CHANGELOG.md) and the [docs](https://example.com/docs).
`;

const program = Effect.gen(function* () {
  const doc = yield* MarkdownDocument.parse(source);
  return doc.links.map((link) => link.url);
});

Effect.runPromise(program).then(console.log);
// [ "./CHANGELOG.md", "https://example.com/docs" ]
```

`headings` lists every heading wherever it sits, including inside blockquotes and list items. `sections` are delimited by root-level headings only, and each section's range spans its subsections, so the edit layer can splice a whole section out in one edit.

For anything the accessors do not cover, `find` and `findAll` walk the whole tree in document pre-order. A string selector matches the node's `type` and narrows the result — `doc.findAll("heading")` is `ReadonlyArray<Heading>`, `doc.find("table")` is `Table | undefined` — and a type-guard predicate narrows the same way. The nodes come back by identity, so `doc.findAll("heading")[1]` addresses the second heading for `MarkdownFormat.modify` without raw child indexing.

`MarkdownVisitor.visit` streams the same walk as `Enter`/`Exit` events carrying the node, its child-index path and its depth:

```ts
import { MarkdownDocument, MarkdownVisitor } from "@effected/markdown";
import { Effect, Stream } from "effect";

const program = Effect.gen(function* () {
  const doc = yield* MarkdownDocument.parse("# Title\n\nA *b* c\n");
  const events = yield* Stream.runCollect(MarkdownVisitor.visit(doc.root));
  return Array.from(events).map((event) => `${event._tag}:${"node" in event ? event.node.type : "?"}`);
});

Effect.runPromise(program).then(console.log);
// [ "Enter:root", "Enter:heading", "Enter:text", "Exit:text", "Exit:heading",
//   "Enter:paragraph", "Enter:text", "Exit:text", "Enter:emphasis", "Enter:text",
//   "Exit:text", "Exit:emphasis", "Enter:text", "Exit:text", "Exit:paragraph", "Exit:root" ]
```

## mdast interop

The node classes already use mdast's type names and field shapes; `Mdast.toMdast` strips the fidelity fields this package adds — bullet characters, fence style, ATX-versus-setext spelling — and emits plain spec-valid mdast JSON that the remark ecosystem consumes directly, including `mdast-util-to-hast` if you want hast:

```ts
import { Markdown, Mdast } from "@effected/markdown";
import { Result } from "effect";

const parsed = Markdown.parseResult("A *b* c\n");
if (Result.isSuccess(parsed)) {
  console.log(JSON.stringify(Mdast.toMdast(parsed.success)).slice(0, 62));
  // {"type":"root","children":[{"type":"paragraph","children":[{"t
}
```

`Mdast.fromMdast` goes the other way as a checked admission boundary: it validates a foreign tree and synthesizes zero-width sentinel positions where one is absent or incomplete. Trees admitted that way serve tree-level workflows and canonical `stringify`; offset-splice editing needs the real positions only a parse produces.

## Features

- `Markdown` — `parse`/`stringify` as `Effect`s with typed `MarkdownParseError`/`MarkdownStringifyError` channels, the pure `parseResult`/`stringifyResult` twins for synchronous callers, and the `MarkdownFromString` two-way codec.
- `MarkdownDocument` — source, tree, diagnostics and the link-definition index, plus the derived `headings`, `sections` and `links` accessors, the `find`/`findAll` tree queries over type-narrowed selectors, and the `frontmatter` capture.
- The mdast-shaped node classes — the CommonMark types plus GFM's `delete`, `table`, `tableRow`, `tableCell`, `footnoteDefinition`, `footnoteReference` and task-list `checked`, each carrying unist positions with byte offsets and this package's fidelity fields. `position` defaults to the zero-width synthetic sentinel, so a replacement fragment constructs in one line — `Text.make({ value: "shipped" })`.
- `MarkdownEdit` / `MarkdownRange` (with `applyAll`) — the non-mutating text-edit vocabulary, field-identical to `@effected/jsonc`'s, `@effected/yaml`'s and `@effected/toml`'s.
- `MarkdownFormat` — `format`/`formatToString` compute conservative marker-normalization edits; `modify`/`modifyToString` replace a node by identity through the canonical stringifier.
- `MarkdownVisitor` — walk a parsed tree as a lazy `Stream` of `Enter`/`Exit` events with child-index paths and depth.
- `Mdast` — `toMdast` projects to plain mdast JSON; `fromMdast`/`fromMdastResult` admit a foreign mdast tree with validation.
- `MarkdownFrontmatter.schema` plus the `YamlFrontmatter`, `TomlFrontmatter` and `JsonFrontmatter` codecs — typed frontmatter decoding over optional per-format peers, with four separately catchable failure modes.
- `SchemaResolver` — classify a frontmatter `$schema` declaration into `ByUrl`/`ByPath`/`Inline`/`ByName` and resolve names against a registry, with no IO and no dependencies.
- `MarkdownDiagnostic` — the structured diagnostic (`code`, `message`, `offset`, `length`, `line`, `character`) every typed error carries, shaped identically to the sibling packages'.

## Conformance

All 652 CommonMark 0.31.2 spec examples run with an empty skip map, and the whole corpus runs again under both dialects with an explicitly asserted divergence list. The GFM extension corpora from cmark-gfm — the spec extension sections and `extensions.txt`, the only official footnote corpus — run complete, as does the 27-fixture `mdast-util-from-markdown` corpus, which asserts AST **and** position equality through the `Mdast` projection rather than just matching rendered output.

Two independent checks back that up. A differential property suite cross-checks the parser against the `commonmark` npm package across the corpus plus tens of thousands of generated documents, and cmark's pathological suite pins the linear-time guarantee with calibrated budgets — markdown's DoS vector is quadratic emphasis and link blowup, and the delimiter-stack algorithm is what defeats it. Recursive surfaces carry a 256-deep nesting cap, so a nesting bomb fails through the typed error channel instead of overflowing the stack. Every oracle and corpus is devDependency-only; none reaches your runtime.

## License

[MIT](LICENSE)
