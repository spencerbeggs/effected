---
id: "0001"
title: "@effected/markdown-lint: LintFrontmatter.node is an Option and LintDiagnostic carries a required severity"
kind: breaking
shows: typed
applies:
  "@effected/markdown-lint": ">=0.3.0"
  "@effected/changesets": ">=0.7.0"
detect: ["frontmatter\\.node", "LintFrontmatter", "LintDiagnostic"]
changesets: ["bright-lint-rules-ship", "breaking-floor-effected-changesets"]
---

Two shapes changed, and the compiler finds both.

`LintFrontmatter.node` is an `Option` of the kit's front-matter node, where it was the node itself. The host now finds front matter the way markdownlint does, and that reading takes blocks the kit parser does not capture (a `{...}` JSON block, a YAML block closed by `...`). When the kit captured the block too, the Option is `Some`; otherwise it is `None`, and `lineCount` and `lines` still describe the block. In a rule that reads `context.frontmatter`, unwrap the outer Option as before, then handle the inner one with `Option.match` or `Option.map`. Do not reach for `Option.getOrThrow`: a `None` is an ordinary input.

`LintDiagnostic` has a required `severity`, `"error"` or `"warning"`, which the host stamps from the configuration. Code that only reads diagnostics from `MarkdownLint.lint`, `lintDocument` or `ChangesetLint.lint` needs no change. Code that constructs a `LintDiagnostic` itself, usually a test fixture or an expected value, must supply it; an exact-equality assertion on a whole diagnostic now sees the extra field.

Check both shapes against the installed `.d.ts`, then run the typecheck.
