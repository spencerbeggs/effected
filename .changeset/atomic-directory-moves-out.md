---
"@effected/store": minor
---

## Breaking Changes

`AtomicDirectory`, `AtomicDirectoryError` and `AtomicDirectoryFiles` are removed from `@effected/store` and now live in `@effected/files`, with no re-export shim (#1234).

Add `@effected/files` and change the import:

```ts
// before
import { AtomicDirectory } from "@effected/store";
// after
import { AtomicDirectory } from "@effected/files";
```
