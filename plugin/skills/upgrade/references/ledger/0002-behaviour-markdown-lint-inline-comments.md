---
id: "0002"
title: "@effected/markdown-lint: inline markdownlint comments are honoured by default"
kind: behaviour
shows: behavioural
applies:
  "@effected/markdown-lint": ">=0.3.0"
  "@effected/changesets": ">=0.7.0"
detect: ["MarkdownLint\\.(lint|lintDocument|lintEffect)", "ChangesetLint\\.lint", "markdownlint-(disable|enable|capture|restore|configure-file)"]
changesets: ["bright-lint-rules-ship", "breaking-floor-effected-changesets"]
---

`MarkdownLint.lint`, `lintDocument` and `lintEffect` now read `<!-- markdownlint-disable -->`, `enable`, `disable-line`, `disable-next-line`, `disable-file`, `enable-file`, `capture`, `restore` and `configure-file` comments, as markdownlint does, and drop a finding whose rule is disabled on its line. Before, the programmatic host ignored them. The comments match a rule by any of its names or tags, so they act on your own `LintRule`s too, not only on built-in ones. `ChangesetLint.lint` runs on the same host, so a changeset file carrying such a comment now suppresses changeset findings.

Search the documents you lint, not only your code: the third pattern finds comments in tracked markdown. A document that carries one may report fewer findings than it did.

Decide per call site. Where the document's author is trusted to silence a rule, do nothing. Where a finding must not be suppressible from inside the document (a gate over submitted content, a required-structure check), pass `noInlineConfig: true` in the options. Then run the tests that lint a document containing a comment.
