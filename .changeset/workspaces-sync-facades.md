---
"@effected/workspaces": minor
---

## Features

* `detectPackageManagerSync(root, ops)` returns a `Result` carrying exactly the decision `PackageManagerDetector` would make, for callers without an Effect runtime.
* `localExecContextSync(cwd, ops)` returns a `Result<Option<ExecContext>, LocalExecError>`. It builds on the new `LocalExec.contextFor()` in `@effected/commands`.

## Refactoring

* The `Workspaces` layer factories are now static methods with real declared signatures. Call shapes are unchanged.
