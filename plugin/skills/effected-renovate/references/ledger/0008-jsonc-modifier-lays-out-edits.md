---
id: "0008"
title: "JsoncModifier and PackageJsonFormat edits lay out to the document, so output bytes change and an insert can return two edits"
kind: breaking
shows: behavioural
applies:
  "@effected/jsonc": ">=0.24.0"
  "@effected/package-json": ">=0.30.0"
detect: ["JsoncModifier\\.", "edits\\[0\\]", "PackageJsonFormat\\.modify"]
changesets: ["jsonc-modifier-lays-out-edits", "package-json-modify-insert-after"]
---

`JsoncModifier` now lays out the text it generates to match the document, and the `PackageJsonFormat.modify*` helpers follow it. The bytes change for callers who pass no `formattingOptions`, and for every delete. Only a test or a run finds it.

- **Output bytes differ.** Multi-line inserted or replaced values are indented to their position, the indent unit is inferred from the document, and a CRLF document keeps its line endings. A delete takes its whole line and collapses an emptied container to `{}` or `[]` unless a comment remains inside. Update any snapshot or golden file that holds modified JSONC or `package.json` text.
- **An insert can return two edits.** On JSONC with a trailing comment the last member's comma and the new member are separate edits. Code that applies `edits[0]` alone no longer sees the whole change: apply the full list with `JsoncEdit.applyAll`.

Run the tests that modify a JSONC or `package.json` file, read each diff, and check the installed `.d.ts` for the option names.
