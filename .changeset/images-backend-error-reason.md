---
"@effected/images": minor
---

## Breaking Changes

`ImageBackendError` has a new required field, `reason`, which is `"backend"` or `"unsupported-content-type"`. `layerDirectory` and `layerFrom` set it themselves; a hand-written `ImageBackend` or test double must pass it.
