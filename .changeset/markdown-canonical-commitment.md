---
"@effected/markdown": patch
---

## Documentation

`Markdown.stringify` and `Markdown.stringifyResult` now state that the canonical form is a **stability commitment**: there are no options to configure, the output is pinned by byte-level tests, the engine is cross-checked against commonmark.js over the full CommonMark 0.31.2 corpus, and changing any canonical choice is a breaking change rather than a patch.

A test may therefore assert on these bytes, and a pipeline needing stable rendered markdown should serialize through here rather than through a third-party stringifier whose defaults are free to move between releases.

Two cases the table calls out explicitly, because both surprise a consumer asserting bytes. **Representability wins over the table**: an indented code block directly after a list would be absorbed as list content, so a `Code` node with neither `lang` nor `fenceChar` emits fenced in that position and indented everywhere else. And **fidelity fields must be set on the decoded tree** — `Mdast.fromMdast` admits spec mdast and strips everything else, so a `fenceChar` placed on a plain mdast tree before admission is silently dropped.

The canonical choices a byte-level assertion depends on — heading style, thematic break, bullet and ordered-list markers, emphasis, code-block style and fence growth, block separation, trailing newline — are published as a table on `Markdown.stringifyResult` and in the README, so a consumer need not read the test suite to know what they are asserting against. A node carrying a fidelity field still overrides the matching row.

## Tests

- Added a "documented canonical form" suite asserting every row of the published table, so the promise and the implementation cannot drift
- Pinned the representability escape in both directions: indented alone and after a paragraph, fenced after a list, and the emitted text reparsing as a list plus a separate code node
