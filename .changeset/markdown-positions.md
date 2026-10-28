---
"@effected/markdown": minor
---

## Breaking Changes

* `MarkdownDocument.lineIndex` is typed as the structural `SourceIndex` interface from `@effected/source`. Annotate with `SourceIndex`, not `LineIndex`.

## Bug Fixes

* Positions come from `@effected/source`, fixing a character of `-1` at the `\n` of a `\r\n`.
