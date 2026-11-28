---
"@effected/plugin": patch
---

## Documentation

- The README now tells bun users to declare `typescript` beside the carrier. bun hoists the `typescript@6` that `@microsoft/api-extractor` depends on and does not install the carrier's 7.x peer, so the bins fail to start with `ERR_MODULE_NOT_FOUND` for `typescript/ast` until the consumer declares it.
