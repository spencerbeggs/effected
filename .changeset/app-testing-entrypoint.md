---
"@effected/app": minor
---

## Breaking Changes

* `App.layerTest` and its option and service types are removed from the root entry. Use `AppTest.layer` from `@effected/app/testing`:

```ts
import { AppTest } from "@effected/app/testing";

const TestPlane = AppTest.layer({ namespace: "myapp" });
```

* `@effected/memfs` is now an optional peer reached only from `./testing`, so the root no longer loads it. Add it as a devDependency wherever tests use `AppTest`.
* The error channel of `AppTest.layer` narrowed from `AppError` to `StoreError | StoreMigrationError | CacheError`.
