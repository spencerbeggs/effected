---
"@effected/images": patch
---

## Bug Fixes

* `ImageBackendError.message` joins the cause chain nearest-first with a bounded, guarded read. When the cause carries no message, the `: <detail>` suffix is omitted instead of showing `String(cause)`.
