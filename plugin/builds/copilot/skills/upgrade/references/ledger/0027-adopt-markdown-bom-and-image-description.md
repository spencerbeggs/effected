---
id: "0027"
title: "@effected/markdown: FrontmatterSource.split skips a leading BOM on request, and MarkdownDocument.imageDescription reads an image's inline content"
kind: adopt
shows: none
applies:
  "@effected/markdown": ">=0.32.0"
  "@effected/changesets": ">=0.9.0"
detect: ["FrontmatterSource\\.split", "\\.alt[^a-zA-Z]"]
closes: ["#1451"]
changesets: ["fix-markdown-frontmatter-bom", "fix-markdown-nested-image-markdown", "breaking-floor-effected-changesets"]
---

- **BOM.** `FrontmatterSource.split(source, { bom: "skip" })` steps over one leading U+FEFF before reading the fence, sets `bom: true` on the result when it did, and keeps every offset relative to the source as passed. Find code that strips a BOM before calling `split` and shifts offsets back afterwards, and replace it with the option. The default is unchanged: without the option a BOM still reads as no fence.
- **Image descriptions.** `MarkdownDocument.imageDescription(image)` returns an image's inline content as positioned phrasing nodes, or `Option.none()` for a node no parse produced. Images keep mdast's shape (a string `alt`, no children); use this instead of re-parsing `alt` when you need what is inside the brackets.
- **Install together.** `@effected/changesets` 0.9.0 peers on `@effected/markdown` `^0.32.0`, so move both in the same install.
