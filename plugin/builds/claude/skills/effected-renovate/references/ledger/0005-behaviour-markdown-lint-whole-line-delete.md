---
id: "0005"
title: "@effected/markdown-lint: a finding's fix may delete its whole line"
kind: behaviour
shows: behavioural
applies:
  "@effected/markdown-lint": ">=0.3.0"
detect: ["fixInfo", "deleteCount", "MarkdownEdit\\.applyAll"]
changesets: ["bright-lint-rules-ship"]
---

A rule's report may now set `deletesLine: true` on its `LintReport`, and the built-in `MD053` does, to remove an unused link reference definition. Such a finding carries two fixes that say the same thing differently:

- Its `fixInfo` is exactly `{ deleteCount: -1 }`, markdownlint's whole-line delete: no `editColumn`, no `insertText`, whatever the edit spans.
- Its `edit` is the kit offset edit over the line. It takes the line's terminator, or, on a last line with none, the line break before it.

`MarkdownLint.applyFixes` applies both as markdownlint does, including a run of deleted lines at the end of the source, where it removes the line break before the run. Code that applies fixes itself does not get that. Applying each finding's `edit` in turn to `x\n\n[a]: u\n[b]: v` leaves `x\n\n`, where `applyFixes` and markdownlint give `x\n`. Code that applies `fixInfo` itself must read `deleteCount: -1` as "delete the line, terminator included", not as a character count.

Find every place that applies a lint finding's `fixInfo` or `edit` by hand, including through `MarkdownEdit.applyAll`, and move it to `MarkdownLint.applyFixes`. Where that is not possible, handle `deleteCount: -1` and check the result against `applyFixes` on a document ending in two unused definitions. Check `LintReport` and `LintFixInfo` in the installed `.d.ts`.
