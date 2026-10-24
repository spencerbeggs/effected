---
"@effected/config-file": patch
---

## Features

* `ConfigCodec` is now a namespace plus interface, with a new type helper `ConfigCodec.ErrorOf<C>` that extracts a codec's error type. Type-only; nothing is emitted at runtime.

## Refactoring

* The `EncryptedCodec` key memo expires failures immediately and caches successes indefinitely, with no API change.
