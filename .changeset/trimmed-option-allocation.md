---
"@effected/runtimes": patch
---

## Performance

Reduced allocation overhead while building runtime release lists in `@effected/runtimes` by avoiding an intermediate `Option[]` and second-pass flatten step in feed-to-model projection.

- Output ordering and filtering semantics are unchanged.
- Public API and compatibility guarantees are unchanged.
