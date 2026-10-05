---
"@effected/engine": minor
---

## Features

### `@effected/engine/guard`

A new subpath with no runtime imports exports `ProcessGuard`, a transport-neutral guard for `uncaughtException` and `unhandledRejection` in a long-running process such as a stdio server. `ProcessGuard.run` installs the listeners before the server's module graph loads, then awaits `load(guard)`. `load` calls `guard.markConnected()` once the server is serving. From then on, the `"exitBeforeConnect"` policy logs a stray error and keeps going instead of exiting. A rejected `load` reports `startup failed` and exits 1.

- `ProcessGuard.parseInjectCrash(value)` parses the `<at>:<kind>` crash-injection grammar a launcher reads from a test-only environment variable. Any value outside that grammar, or no value, returns `undefined`.
- The supporting types are `ProcessGuardHost`, `ProcessGuardPolicy`, `ProcessGuardInjection`, `ProcessGuardControl` and `ProcessGuardOptions`.
