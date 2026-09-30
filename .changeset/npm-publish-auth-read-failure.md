---
"@effected/npm": patch
---

## Bug Fixes

* `PackagePublish.setupAuth` now treats only a missing `.npmrc` as empty. Any other read failure, such as permission denied or a directory in the way, fails with a `PublishError` of kind `"auth"` instead of silently overwriting the existing file and dropping its prior config lines.
