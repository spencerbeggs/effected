---
"@effected/markdown-lint": minor
---

## Features

### Initial release

`@effected/markdown-lint` lets you write a markdown lint rule once, against `@effected/markdown` trees, and run it two ways: with a pure programmatic linter, or inside markdownlint as a custom rule. Line numbers, ranges and fixes come from the kit's own positions, so the two hosts report the same findings on the same lines. It imports no markdownlint: you bring your own, and the adapter is checked against markdownlint-cli2 0.24 (markdownlint 0.42).

```ts
import { LintRule, MarkdownLint, MarkdownlintAdapter } from "@effected/markdown-lint";

const NoH1 = LintRule.make({
  names: ["no-h1", "X001"],
  description: "No level-1 headings",
  tags: ["headings"],
  check: (context, report) => {
    for (const heading of context.document.findAll("heading")) {
      if (heading.depth !== 1) continue;
      report(context.diagnostic({ at: heading, detail: "Use ## for top-level sections", range: true }));
    }
  },
});

// Run it programmatically: pure, synchronous and total.
const findings = MarkdownLint.lint("---\ntitle: Notes\n---\n\n# Notes\n", [NoH1], { name: "notes.md" });

// Or inside markdownlint, from `.markdownlint-cli2.mjs`.
export default { customRules: MarkdownlintAdapter.rules([NoH1]) };
```

* `LintRule.make` checks a rule's metadata against markdownlint's own custom-rule validation and throws on a violation, so markdownlint never refuses an adapted rule at lint time
* `MarkdownLint.lint` counts lines across the whole file, frontmatter included. `lintDocument` runs rules over a parsed document, and `lintEffect` is `lint` under a span
* `MarkdownlintAdapter` parses each file once however many adapted rules run, and inline disable comments, `--fix` and every output format work as for markdownlint's own rules
* `PositionMapping` turns kit offsets into markdownlint's lines, columns, ranges and fixes, and each finding also keeps its fix as a kit `MarkdownEdit`
