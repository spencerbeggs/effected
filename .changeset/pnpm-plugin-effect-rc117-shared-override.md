---
"@effected/pnpm-plugin-effect": patch
---

## Bug Fixes

Consumers get a scoped override that keeps tools still built on effect rc.117 from crashing at startup. `@effect/platform-node@4.0.0-rc.117` takes `@effect/platform-node-shared` with a caret, so a fresh resolve paired it with the rc.118 shared package. That package imports `effect/process/ChildProcess`, which rc.117 does not ship. The override pins the shared package to `4.0.0-rc.117` under that parent only, so no install on rc.118 is touched, and a consumer's own `overrides` are kept alongside it; a consumer value for the same selector wins.
