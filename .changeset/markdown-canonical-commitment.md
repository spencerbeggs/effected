---
"@effected/markdown": patch
---

## Documentation

`Markdown.stringify` and `Markdown.stringifyResult` now state that the canonical form is a **stability commitment**: there are no options to configure, the output is pinned by byte-level tests, the engine is cross-checked against commonmark.js over the full CommonMark 0.31.2 corpus, and changing any canonical choice is a breaking change rather than a patch.

A test may therefore assert on these bytes, and a pipeline needing stable rendered markdown should serialize through here rather than through a third-party stringifier whose defaults are free to move between releases.

The canonical choices a byte-level assertion depends on — heading style, thematic break, bullet and ordered-list markers, emphasis, code-block style and fence growth, block separation, trailing newline — are published as a table on `Markdown.stringifyResult` and in the README, so a consumer need not read the test suite to know what they are asserting against. A node carrying a fidelity field still overrides the matching row.

## Tests

- Added a "documented canonical form" suite asserting every row of the published table, so the promise and the implementation cannot drift
