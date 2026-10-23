---
"@effected/templates": patch
---

## Bug Fixes

- An unstubbed member of `ManagedSection.makeTest` now dies when its effect runs (`Effect.die`). Calling the member only builds the effect.
