---
"@effected/github-actions": minor
---

## Features

- New `ActionOutputs.recording()` test double: every member journals a `RecordedOutput { member, name?, value }` in call order, with `setJson` recording the schema-encoded JSON text — what a later step's `steps.<id>.outputs.<name>` expression would actually read:

```ts
import { ActionOutputs } from "@effected/github-actions";

const { layer, entries } = ActionOutputs.recording();
// provide `layer`, run the program, then:
entries(); // ReadonlyArray<RecordedOutput>, in call order
```

## Bug Fixes

- `ActionOutputs.makeTest` and `layerTest` now always run the typed schema encode on `setJson` before calling any supplied override, so a `setJson` override that ignores `schema` can no longer let a value/schema drift pass silently — it now fails typed with `OutputEncodeError` exactly as the real layer would. A test relying on the old bypass now fails until the override (or the value) is corrected.
