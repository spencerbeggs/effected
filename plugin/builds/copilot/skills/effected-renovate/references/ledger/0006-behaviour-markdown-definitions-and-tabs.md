---
id: "0006"
title: "@effected/markdown: tabbed link and definition destinations, and definitions above a table, now parse"
kind: behaviour
shows: behavioural
applies:
  "@effected/markdown": ">=0.30.0"
detect: ["Markdown(Document)?\\.parse|MarkdownFromString"]
changesets: ["tabs-and-tables-read-true"]
---

Two inputs that parsed as paragraph text now parse as CommonMark and GFM read them. The tree, and everything read from it, changes for documents that hold them:

- **Tabs around a destination or title.** A tab is now accepted as the whitespace around a link reference definition's destination and title, and around an inline link's. `[a]:<TAB>/u<TAB>"t"` is a `definition`, and a `[a]` that uses it is a `linkReference`, where both were paragraph text. `[x](<TAB>/u<TAB>"t"<TAB>)` is a `link`.
- **A definition directly above a table's header row.** In `[t]: https://example.com`, then `| a | b |`, `| - | - |` on the following lines, the first line is a `definition` before the `table`, where it was a paragraph. Text after such a definition stays a paragraph, as anywhere.

Nothing is renamed, and output for every other input is unchanged. Search for code that parses markdown, then check the documents it reads for a tab inside a link or definition, and for a definition with no blank line before a table. Rerun the tests and snapshots that cover them. A new `definition` or `link` node, or a reference that now resolves, is this entry, not a regression. If anything walks the tree for definitions or links, check its counts too.
