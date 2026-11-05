---
"@effected/jsonc": minor
---

## Breaking Changes

`JsoncModifier` now lays out the text it generates to match the document (#1208, #1209), so the bytes it produces change for callers who pass no `formattingOptions` and for every delete.

* An insert can return two edits on JSONC with a trailing comment (the last member's comma and the new member). `JsoncEdit.applyAll` handles them; code that takes `edits[0]` alone no longer sees the whole change.
* Inserted and replaced multi-line values are indented to their position, a CRLF document keeps its line endings, and the indent unit is inferred from the document when `formattingOptions` is absent.
* A delete takes its line with it and collapses an emptied container to `{}` or `[]`, unless a comment remains inside.

## Features

* `insertAfter` places a new member directly after a named sibling instead of last.
* `createParents` builds missing object ancestors instead of failing. It never overwrites a value of the wrong type, never invents an array, and stops at the parser's 256 nesting levels with a typed failure.

## Bug Fixes

* A trailing-comma case no longer writes the new member outside the enclosing object.
* A plain append keeps the last member's trailing comment with that member.
