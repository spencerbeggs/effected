---
"@effected/memfs": patch
---

## Bug Fixes

* Copying onto `dir/.` or `dir/..` now fails the way `node:fs` does
* Renaming a path involving `/` now fails with the `node:fs` error
* The synchronous `realPath` on win32 reports the same error path as `node:fs`
* `realPath` folds a link target's `..` segments lexically, matching `node:fs`
* Copying onto a missing `dir/.` remains a recorded divergence from `node:fs`
