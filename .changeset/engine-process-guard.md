---
"@effected/engine": minor
---

## Features

### `@effected/engine/guard`

A new dependency-free subpath exports `ProcessGuard`, a transport-neutral guard for `uncaughtException` and `unhandledRejection` in a long-running process such as a stdio server. `ProcessGuard.run` wraps the program, and the guard exposes a `markConnected()` hook so the crash report can say whether a client was connected. The supporting types are `ProcessGuardHost`, `ProcessGuardPolicy`, `ProcessGuardInjection`, `ProcessGuardControl` and `ProcessGuardOptions`.
