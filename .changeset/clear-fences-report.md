---
"@effected/markdown": minor
---

## Breaking Changes

### Frontmatter reports an unclosed fence

`FrontmatterMissingReason` gains `"unclosed"`. A source that opens a frontmatter fence and never closes it now fails the frontmatter decoders with that reason instead of `"absent"`. The document still parses with the fence as ordinary content.

To migrate:

* Add an `unclosed` arm to an exhaustive `switch` or `Match.exhaustive` over the reason. The compiler finds these
* Review comparisons such as `reason === "absent"`, which compile and change meaning. To keep the old result, handle both reasons

### Parsed `Frontmatter` nodes carry `valueStart`

A parsed `Frontmatter` node gains `valueStart`, so a deep-equality check against a hand-built `Frontmatter.make({...})` now differs. Compare the fields you care about instead.

## Features

### `@effected/markdown/stringify`

A new subpath for code that builds trees and emits Markdown but never parses, such as a Worker. It exports the node classes, `stringify`, `stringifyResult`, `MarkdownStringifyError` and `MarkdownDiagnostic`, and reaches neither the parser nor the HTML entity table. A stringify-only bundle measured about 22 KB minified against about 105 KB through `Markdown.stringifyResult`, with `effect` and `@effected/source` left external. The output bytes are the same, and both functions are on the root entry too.

```ts
import { Heading, Root, Text, stringifyResult } from "@effected/markdown/stringify";
import { Result } from "effect";

const tree = Root.make({ children: [Heading.make({ depth: 2, children: [Text.make({ value: "Usage" })] })] });
console.log(Result.getOrThrow(stringifyResult(tree)));
// ## Usage
```

### Frontmatter fence state and offsets

`FrontmatterSource.split` now reports `fence` (`absent`, `unclosed` or `closed`) and `fenceFormat`, and its block carries `valueStart` and `valueEnd`. `MarkdownDocument.frontmatterFence` answers the same state on a parsed document, so a linter no longer needs its own fence arithmetic.

### Unresolved footnote references

`MarkdownDocument.unresolvedFootnoteReferences` lists each `[^label]` marker that has no definition, with its `label`, `identifier` and `position`. A marker inside a code span never appears, and the node tree does not change.

### `MarkdownVisitor.traverse`

A synchronous walk driven by `enter` and `exit` callbacks. Return `MarkdownVisitor.SKIP` from `enter` to stay out of a node's children, or `MarkdownVisitor.EXIT` to stop. Each callback also gets the node's `path`, `depth` and `ancestors`.

```ts
import { Markdown, MarkdownVisitor } from "@effected/markdown";
import { Result } from "effect";

const root = Result.getOrThrow(Markdown.parseResult("# A\n\n> # B\n\n## C\n"));
const depths: Array<number> = [];
MarkdownVisitor.traverse(root, ["heading", "blockquote"], {
  enter: (node) => {
    if (node.type === "blockquote") return MarkdownVisitor.SKIP; // headings quoted inside are not visited
    depths.push(node.depth);
    return undefined;
  },
});
console.log(depths);
// [ 1, 2 ]
```
