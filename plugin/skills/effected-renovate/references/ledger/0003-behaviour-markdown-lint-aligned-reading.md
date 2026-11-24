---
id: "0003"
title: "@effected/markdown-lint: the host reads a document as markdownlint does"
kind: behaviour
shows: behavioural
applies:
  "@effected/markdown-lint": ">=0.3.0"
  "@effected/changesets": ">=0.7.0"
detect: ["LintRule\\.make", "context\\.(source|lines|frontmatter)", "lintDocument"]
changesets: ["bright-lint-rules-ship", "breaking-floor-effected-changesets"]
---

The programmatic host now gives a rule the same reading markdownlint gives a custom rule. Four things a rule can observe changed. Positions did not: every line number still counts the whole file.

- HTML comment bodies are masked. In `context.source` and `context.lines`, the text between `<!--` and `-->` is replaced by `.` characters of the same length. A rule that searches the raw text no longer matches inside a comment. A rule that was reading comment text on purpose must read it from the tree's `html` nodes instead.
- Front matter follows markdownlint's pattern. `context.frontmatter` is present for a `{...}` JSON block and a YAML block closed by `...`, and its `lineCount` and `lines` include the blank lines after the closing fence. Its `node` is an Option (entry 0001).
- A `---json` fenced block at the head of a file is content, not front matter, because markdownlint does not recognise it. A rule that skipped it by front-matter line count now sees it as body lines.
- `lintDocument` drops one leading byte-order mark and parses the source again when the document it was handed does not match this reading. Pass the `dialect` the document was parsed with in its options, or the second parse uses the default dialect.

Under `MarkdownlintAdapter`, a rule also receives markdownlint's `params.config` as `context.config`, with `enabled` and `severity` removed. A rule that worked around the missing settings can read them there.

Run the tests of every custom rule against a document with an HTML comment and one with front matter. A changed finding count there is this entry, not a regression in the rule.
