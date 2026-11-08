---
id: "0015"
title: "@effected/markdown/stringify emits Markdown without bundling the parser"
kind: adopt
shows: none
applies:
  "@effected/markdown": ">=0.28.0"
detect: ["Markdown\\.stringify"]
closes: ["spencerbeggs/effected#1218"]
---

Offer this to the user; never apply it unasked. It suits code that builds a tree from the node classes and emits Markdown but never parses, where bundle size is a budget, as on a Worker.

The `@effected/markdown/stringify` subpath exports `stringify`, `stringifyResult`, `MarkdownStringifyError`, `MarkdownDiagnostic` and the whole node vocabulary, and nothing it reaches loads the parser or the entity table. A stringify-only bundle measured about 22 KB minified, against about 105 KB through `Markdown.stringifyResult`, with `effect` and `@effected/source` left external.

- Replace `Markdown.stringify` with the free `stringify`, and `Markdown.stringifyResult` with `stringifyResult`. They behave the same, and the values are the root's own.
- **Move every import in that bundle.** One remaining import from the root entry can bring the parser back, so measure the bundle after the change.
- Leave code that also parses on the root entry. It gains nothing here.

Read the installed `.d.ts` for the exact shapes.
