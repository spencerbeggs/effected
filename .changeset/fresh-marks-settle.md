---
"@effected/markdown": minor
---

## Features

### Canonical stringify

`Markdown.stringify` and `stringifyResult` take a new `MarkdownStringifyOptions` argument. By default a node's fidelity fields (`bulletChar`, `headingStyle`, `markerChar`, `fenceChar`, `delimiter`) still win, so a parsed `* a` list or setext heading is written back as it was. Pass `{ canonical: true }` to ignore them and emit the canonical form. Closes #1095.

`MarkdownTransform.canonicalize(tree)` returns a copy of the tree with those fields cleared and never mutates the input. Either route gives the same output as the `Mdast.toMdast` / `Mdast.fromMdastResult` round trip it replaces. A tree nested too deeply on the canonical path fails with the serializer's usual nesting-depth guard rather than overflowing the stack.
