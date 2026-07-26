---
"@effected/walker": patch
---

## Refactoring

`Walker` is now a static class with a private constructor rather than an
`as const` namespace object. Call syntax is unchanged (`Walker.ascend(...)`);
each member's TSDoc now ships in the built `.d.ts`, where an `as const`
object's inferred member types previously dropped it.
