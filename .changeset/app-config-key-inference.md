---
"@effected/app": patch
---

## Bug Fixes

- `AppConfig.layer` once again infers the config type `A` from the key. A bare `MergeStrategy.firstMatch()` passed as `strategy` no longer causes a correctly shaped `ConfigFile.Service` key to be rejected. A key whose shape adds members to `ConfigFileShape<A>` is still a compile error.
