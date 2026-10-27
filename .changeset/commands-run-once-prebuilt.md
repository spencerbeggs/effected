---
"@effected/commands": minor
---

## Features

* `RunOnce` is a cross-process run-once lock with a sync driver (`runSync`, `commandSync`, hosts from `./node-sync`) and an Effect driver (`RunOnce.run`, needing `FileSystem` and `ProcessLiveness`). Stale owners are taken over through a breaker file, and a wait timeout falls through as `RanUnserialized`. `windowsVerbatimArguments` is passed through to `spawnSync`.
* `PrebuiltBinary.resolveSync` resolves a platform package from `optionalDependencies` and fails with `unsupportedTarget`, `notInstalled`, `binaryMissing` or `unresolvable`; `./node-sync` supplies `nodePrebuiltHost`.
* `LocalExec.parse(argv)` is the inverse of `LocalExec.prefixes`.
* `ModuleResolution` (`./node-sync`) resolves a package from a given root, detects a stale install and loads through an injectable importer.

## Bug Fixes

* `RunOnce.run` could delete a rival's live lock after a non-EEXIST create failure. It now removes only a file it created, and no driver deletes after a failed write any more: a half-written lock is left to be taken over once older than `staleMs`.
