---
"@effected/markdown": minor
---

## Features

### `MarkdownTransform`

A new `MarkdownTransform` class holds pure, total tree-to-tree transforms over the node classes. None has an error channel, so each is a plain return value. Offset-splice editing stays with `MarkdownFormat` and `MarkdownEdit`.

* `MarkdownTransform.map(node, handlers)` rewrites a tree with at most one handler per node `type`. It visits post-order, children left to right, and that order is a contract a handler may rely on. Unchanged subtrees are shared by reference. A handler for a phrasing-only type (`link`, `emphasis`, `text` and the like) may return any `PhrasingContent`, for example turning a `link` into a `linkReference`. An `html` handler must return an `Html`, because `html` is also valid where only flow content is allowed. Every other handler returns a node of its own type.
* `MarkdownTransform.shiftHeadings(node, by, { min?, max? })` moves every heading by `by` levels. Depths clamp to 1–6 by default, or to the `min`/`max` you pass. A shifted heading deeper than 2 drops its setext style, since setext only expresses depths 1 and 2.
* `MarkdownTransform.sections(root, { depth, start?, end? })` finds sections over an in-memory `Root` and returns child-index spans: the heading, its index and the exclusive index where its section ends. It shares its boundary rule with `MarkdownDocument.sections`, so both agree on where a section stops.

New exported types: `MarkdownPhrasingOnlyType`, `MarkdownTransformHandlers`, `MarkdownTransformResult`, `SectionSpan`, `SectionSpanOptions` and `ShiftHeadingsOptions`.

### `Markdown.stringify` accepts a single block node

`Markdown.stringify` and `Markdown.stringifyResult` now take `Root | FlowContent` instead of only `Root`. A lone block node stringifies exactly as a root holding that one child would, so a transformed section or paragraph can be rendered without wrapping it first.

### `Mdast.toText`

`Mdast.toText(node, options?)` returns the plain text of a node, matching `mdast-util-to-string`. Its options type is the new exported `MdastToTextOptions`.
