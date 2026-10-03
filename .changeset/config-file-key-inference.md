---
"@effected/config-file": patch
---

## Bug Fixes

- `ConfigFile.layer` and `ConfigFile.testLayer` once again infer the config type `A` from the key. Since 0.14.1, a call whose options carried no `A` of their own, such as a bare `MergeStrategy.firstMatch()` strategy, inferred `A` as `unknown`. A correctly shaped `ConfigFile.Service` key then failed with "not assignable to parameter of type `Key<…, ConfigFileShape<unknown>>`". Remove any explicit type arguments you added as a workaround.
- A key whose shape adds members to `ConfigFileShape<A>` is still a compile error.
