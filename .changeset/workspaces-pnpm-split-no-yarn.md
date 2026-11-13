---
"@effected/workspaces": minor
---

## Breaking Changes

* `PnpmSettings` moved to `@effected/pnpm`.
* The `PeerDependencyRules` type and `NoPeerDependencyRules` are removed. Use `PeerDependencyRules` from `@effected/pnpm`, which has a `.empty` value and optional axes. An object literal no longer satisfies `PeerCheckOptions.peerDependencyRules`; pass a `PeerDependencyRules`.
* `"yarn"` is no longer a `PackageManagerName`.
* A yarn root is refused when the package acts on it. `UnsupportedPackageManagerError` reports it, and `LocalExec` and `localExecContextSync` fail with it. Discovery still works on yarn repos through `package.json#workspaces`.
* A root whose only package-manager evidence is an undeclared `yarn.lock` now reports unsupported. It used to fall back to npm.
* The package is now a boundary-tier library.

## Features

* Catalog resolution is implemented against pnpm 12: `link:` and `file:` catalog entries resolve as written. The `@pnpm/catalogs.*` dependencies are dropped.
* The `PublishConfig` projection gains `name`.

## Bug Fixes

* Catalog and importer lookups no longer match inherited object keys.
