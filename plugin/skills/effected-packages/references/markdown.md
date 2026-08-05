# @effected/markdown

CommonMark 0.31.2 + GFM as pure schemas: parse to mdast-shaped nodes with byte offsets, **construct those nodes and serialize them back**, edit by offset splice, format, project to and from plain mdast, and read frontmatter through free-standing codecs. Second in size only to `yaml`. Pure tier: peers on `effect`, and *optionally* on `@effected/yaml` / `@effected/toml` / `@effected/jsonc` — consumed only by the three frontmatter codec modules, so parsing markdown pulls in none of them.

**It is not a parser-only package.** Three independent readers have concluded it was, from an `index.ts` that leads with `Markdown` / `MarkdownDocument` / `MarkdownEdit` / `MarkdownFormat` / `MarkdownVisitor` / `Mdast`. The authoring surface is the 28 node classes in `MarkdownNode.ts`, which you construct with `new` and hand to `Markdown.stringify`. If you want to *build* a table, a heading or a link — not just read one — this is the package.

## Import

```ts
import { Markdown, MarkdownDocument, MarkdownFormat, Mdast } from "@effected/markdown";
import { Heading, Paragraph, Table, TableCell, TableRow, Text } from "@effected/markdown";
```

Single entrypoint; no subpaths.

## Core API

- **`Markdown`** (facade) — `parseResult(text, options?)` → `Result<Root, MarkdownParseError>` and `parse` (the Effect form); `stringifyResult(root)` → `Result<string, MarkdownStringifyError>` and `stringify` (the Effect form); the `MarkdownFromString` codec. Both directions ship the sync `Result` primitive alongside the `Effect` per the house formatter convention.
- **The 28 node classes** (`MarkdownNode.ts`) — `Root Paragraph Heading Text Emphasis Strong Delete InlineCode Code Html Break Link LinkReference Image ImageReference Definition Footnote{Reference,Definition} List ListItem Blockquote ThematicBreak Table TableRow TableCell Frontmatter Point Position`. Every one is a `Schema.Class`, so `new Heading({ depth: 2, children: [...] })` validates on construction. Plus the supporting literal unions: `HeadingDepth`, `HeadingStyle`, `BulletChar`, `FenceChar`, `EmphasisChar`, `BreakStyle`, `ListDelimiter`, `TableAlign`, `ReferenceType`, `FrontmatterFormat`, and the content-set types `FlowContent` / `PhrasingContent` / `ListContent` / `TableContent` / `RowContent`.
- **`MarkdownDocument`** — the lossless document: `parseResult` / `parse`, `source`, `body`, `diagnostics`, plus the navigation accessors `headings`, `sections`, `links`, `frontmatter` and `hasFrontmatterBlock`. Section finders: `firstSection`, `sectionByHeading` (`SectionQueryOptions`, `SectionHeadingMatch`), each `DocumentSection` carrying `range` / `bodyRange` / `children`.
- **`MarkdownEdit`** + `MarkdownRange` + `applyAll` — the offset-splice edit vocabulary, parity-identical in shape to jsonc/yaml/toml.
- **`MarkdownFormat`** — marker normalization and surgical replacement. `MarkdownFormattingOptions` carries the knobs, including **`codeBlockStyle`** (`CodeBlockStyle` = `"fenced" | "indented"`), the opt-in that converts between the two code-block spellings. Absent it, a language-less block keeps whatever it had.
- **`Mdast`** — the remark-ecosystem interop boundary: project to plain mdast JSON and decode back, checked. Markdown→HTML and HTML→markdown are **permanently out of scope**; project via `Mdast` and hand the plain tree to a renderer.
- **`MarkdownVisitor`** — `Stream` tree walk.
- **Frontmatter** — `MarkdownFrontmatter` plus the three free-standing codecs `YamlFrontmatter` / `TomlFrontmatter` / `JsonFrontmatter` (never a namespace object; each drags only its own format package). `FrontmatterResolver` / `SchemaResolver` resolve a declared schema by name, path, URL or inline.
- **`MarkdownDiagnostic`** — `code` (`MarkdownParseErrorCode`), message, offsets, line/character.

## Usage

Building a tree and serializing it — the surface most readers miss:

```ts
import { Heading, Markdown, Paragraph, Root, Text } from "@effected/markdown";
import { Effect } from "effect";

const program = Markdown.stringify(
 new Root({
  children: [
   new Heading({ depth: 2, children: [new Text({ value: "Results" })] }),
   new Paragraph({ children: [new Text({ value: "All green." })] }),
  ],
 }),
);
```

A GFM table, node by node:

```ts
import { Table, TableCell, TableRow, Text } from "@effected/markdown";

const cell = (value: string) => new TableCell({ children: [new Text({ value })] });

const table = new Table({
 align: ["left", "right"],
 children: [
  new TableRow({ children: [cell("package"), cell("count")] }),
  new TableRow({ children: [cell("markdown"), cell("101")] }),
 ],
});
```

Reading structure out of a document:

```ts
import { MarkdownDocument } from "@effected/markdown";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const document = yield* MarkdownDocument.parse("# Title\n\n## Install\n\nRun it.\n");
 const section = document.sectionByHeading("Install");
 return { headings: document.headings.map((h) => h.text), section };
});
```

## Testing machinery

None exported. The conformance harness (652 CommonMark examples, the GFM extension corpora, the 27 position-complete mdast interop fixtures) is internal — see `building-a-format-package` for the shared corpus architecture.

## Gotchas

- **The node classes are the builder API.** Reaching for `remark`/`mdast-util-to-markdown` to *emit* markdown from this repo is re-implementing a surface the package already ships.
- **`Frontmatter` is captured behind a parse toggle**, and absence is ambiguous without help: `FrontmatterMissingError.reason` (`FrontmatterMissingReason` = `"absent" | "captureDisabled"`) distinguishes "the source had no block" from "you parsed with capture off," and `MarkdownDocument.hasFrontmatterBlock` is the non-failing form of the same question. Reading `frontmatter === undefined` alone conflates the two.
- **Frontmatter codecs are free-standing named exports**, deliberately never collected into a namespace object — touching one would otherwise reach every format engine.
- **A constructed node needs no `position`.** Every node class defaults it to `Position.synthetic`, which is what makes `new Heading({ depth, children })` ergonomic — but it also means a synthesized node's position is a shared sentinel. Never assert one by reference.
- Definitions and references are kept **unresolved** (a deliberate port delta from commonmark-js); resolve them yourself from `document.definitions` if you need link targets.
- Node positions are **byte offsets**, not UTF-16 code-unit indices — the same convention as the other format packages, and the reason edits splice cleanly across them.
