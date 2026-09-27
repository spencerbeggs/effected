---
"@effected/lockfiles": minor
---

## Features

### Read the package manager pinned in pnpm-lock.yaml

`PnpmEnvLockfile.packageManager(content)` reads the pnpm version a `pnpm-lock.yaml` pins, and the integrity pnpm recorded for it. It reads from the env preamble, the first of the two YAML documents pnpm 11 and 12 write when a workspace declares `devEngines.packageManager` or `configDependencies`. Like `Lockfile.parse`, it takes the text and performs no IO.

It succeeds with `Option.some` of a `PackageManagerLock`, which carries:

* `specifier` verbatim, including any `+sha512.<hex>` suffix.
* `version`, the exact version pnpm resolved.
* `integrity`, the SRI of `pnpm@<version>`.
* `nativeIntegrity`, the SRI of each native package keyed by bare name (`"@pnpm/exe.linux-x64"`). pnpm 12 records one per platform. For pnpm 11 it is empty.

A lockfile that records no package manager returns `Option.none()`. That covers a single-document lockfile and a preamble with no `pnpm` package-manager dependency. A lockfile that records a version it cannot back fails with `LockfileParseError` at `stage: "validation"` instead. That happens when the `pnpm@<version>` entry, its snapshot or its SRI integrity is missing, or when a native lacks its integrity. A stream of more than two documents fails with `LockfileFramingError`.

### Read the config dependencies recorded in pnpm-lock.yaml

`PnpmEnvLockfile.configDependencies(content)` reads the config dependencies a `pnpm-lock.yaml` env preamble records, as a `ReadonlyMap` keyed by name. Each value is a `ConfigDependencyLock` carrying `specifier`, `version` and the SRI `integrity`. A workspace that writes `configDependencies` as bare versions keeps their integrity only here (#842).

A lockfile that records none returns an empty map. It fails the same way `packageManager` does: an entry with no `packages` entry, no integrity, a non-SRI integrity or an empty version fails with `LockfileParseError` at `stage: "validation"`. An entry is never silently dropped.
