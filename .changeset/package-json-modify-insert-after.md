---
"@effected/package-json": minor
---

## Features

* `PackageFieldEdit` (#1208, #1209) and `PackageJsonFormat.modify*` accept `insertAfter`, which places a new key directly after a named sibling, and `createParents`, which builds missing object ancestors instead of failing. A new `PackageModifyOptions` type names both options.
* Edits follow the `@effected/jsonc` layout fixes: inserted values are indented to their position, CRLF files keep their line endings, and deletes clean up after themselves, so output bytes change for deletes and for callers without `formattingOptions`.
