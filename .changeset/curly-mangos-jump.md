---
"@effected/markdown": minor
---

## Features

### MDX node vocabulary

Adds a construct-and-serialize-only MDX node set — eight new node classes shaped exactly to the `mdast-util-mdx-jsx`, `mdast-util-mdx-expression` and `mdast-util-mdxjs-esm` contracts: `MdxJsxFlowElement`, `MdxJsxTextElement`, `MdxJsxAttribute`, `MdxJsxExpressionAttribute`, `MdxJsxAttributeValueExpression`, `MdxFlowExpression`, `MdxTextExpression` and `MdxjsEsm`. The parser still reads no MDX syntax — these exist so a hand-built or programmatically constructed tree can carry MDX content and round-trip through `Markdown.stringify`:

```ts
import { Markdown, MdxJsxFlowElement, MdxJsxAttribute } from "@effected/markdown";

const tree = MdxJsxFlowElement.make({
	name: "Alert",
	attributes: [MdxJsxAttribute.make({ name: "level", value: "warning" })],
	children: [],
});
```

Serialization matches the mdast-util-mdx oracles byte for byte, and escaping is keyed on MDX-node presence rather than an option: a tree with no MDX nodes still serializes byte-identical to the documented canonical form.

### Phrasing-only parsing

`Markdown.parsePhrasingResult` (sync `Result`) and `Markdown.parsePhrasing` (`Effect`) parse a text fragment as a single paragraph's inline content — useful when a caller only has a prose fragment, not a whole document:

```ts
import { Markdown } from "@effected/markdown";
import { Result } from "effect";

const ok = Markdown.parsePhrasingResult("see [the docs](./docs.md)");
if (Result.isSuccess(ok)) {
	console.log(ok.success.map((node) => node.type)); // => ["text", "link"]
}
```

### String-level frontmatter split and join

`FrontmatterSource.split` and `FrontmatterSource.join` handle a document's frontmatter fence at the raw-string level, without parsing the body at all — for callers who need byte-exact boundaries (e.g. a content hash over the body) or whose body isn't CommonMark:

```ts
import { FrontmatterSource } from "@effected/markdown";

const split = FrontmatterSource.split("---\ntitle: hi\n---\n\n# Body\n");
console.log(split.frontmatter?.format); // => "yaml"
console.log(split.body); // => "\n# Body\n"
```
