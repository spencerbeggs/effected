---
id: "0013"
title: "@effected/markdown: frontmatter fence state and value offsets replace fence arithmetic"
kind: adopt
shows: none
applies:
  "@effected/markdown": ">=0.28.0"
detect: ["detectFence", "frontmatterValueStart", "toFileOffset"]
closes: ["spencerbeggs/effected#1187"]
---

Offer this to the user; never apply it unasked. It replaces local code that tells an unclosed fence from no fence, or works out where the value starts by counting a fence and its terminator.

- **`FrontmatterSource.split`** reports `fence` (`absent`, `unclosed` or `closed`) and `fenceFormat`, and its block carries `valueStart` and `valueEnd`.
- **`MarkdownDocument.frontmatterFence`** answers the same state on a parsed document.
- **The parsed `Frontmatter` node** carries `valueStart`, the file offset of the value's first character. Add a YAML offset to it to get a file offset for a diagnostic range.

Check one difference before swapping. The grammar accepts `+++` for TOML and `---json` for JSON as well as `---`. A repository that allows only `---` must also reject on `fenceFormat`, or those fences start being read.

Read the installed `.d.ts` for the exact shapes.
