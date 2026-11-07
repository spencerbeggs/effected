---
id: "0014"
title: "@effected/markdown: MarkdownDocument.unresolvedFootnoteReferences lists markers that have no definition"
kind: adopt
shows: none
applies:
  "@effected/markdown": ">=0.28.0"
detect: ["footnote-undefined"]
closes: ["spencerbeggs/effected#1189"]
---

Offer this to the user; never apply it unasked. It replaces a regular-expression scan for `[^label]`, with its own code-span exclusion, in a lint that reports an undefined footnote.

`MarkdownDocument.unresolvedFootnoteReferences` lists each marker with its `label`, `identifier` and `position`. The parse records them at the moment it rejects them, so a marker inside a code span never appears. The node tree does not change: an undefined marker is still literal text, and `findAll("footnoteReference")` still finds only resolved ones.

The getter has no error channel. A document built with `make` whose source trips the nesting guard throws a defect, as the other navigation getters do.

Compare its answers with the existing scan on that lint's fixtures before removing the scan. Read the installed `.d.ts` for the exact shapes.
