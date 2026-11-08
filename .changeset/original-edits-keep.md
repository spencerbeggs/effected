---
"@effected/markdown-lint": minor
---

## Bug Fixes

* Edits for a file that starts with a BOM are reported against the original text, so their offsets line up with the file on disk
* `lintDocument` keeps the BOM, and its documentation says so
