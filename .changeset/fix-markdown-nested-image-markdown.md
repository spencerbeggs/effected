---
"@effected/markdown": minor
---

## Features

* `MarkdownDocument.imageDescription(image)` returns an image's description: the inline content between its brackets, as phrasing nodes positioned in the document's source, or `Option.none()` for a node the parse did not produce. Images keep mdast's shape (no children, a string `alt`); the description is kept beside the tree and materialized on the first lookup, so parsing costs the same and accepts the same inputs. A nested image is a leaf of its holder's description, and the same lookup returns its own, so a chain of nested images reads one level at a time.
