---
"@effected/changesets": minor
---

## Breaking Changes

* `ReleasePlan.read` detects the release manager first. A malformed `versioning` block now fails a changesets-only workspace with `PnpmSettingsError`.
* Edits and floors refuse a plan that releases two same-named projects.
* `ReleasePlan.read`'s error channel widens to `VersioningError`, `AmbiguousPackageError`, `PnpmSettingsError`, `LedgerError` and `RegistryReadError`.
* `@effected/npm` is now a required peer dependency rather than a regular dependency, because `NpmConfig` crosses into `RegistryVersions.layerFrom` and must be the same copy the caller holds. Install it beside this package.

## Features

### pnpm-native release planning

Releases can be planned from pnpm's own `versioning` settings, closing #1316. `ReleaseManager` detects which system a workspace uses. The planner supports lanes, epics, `maxBump`, `ignore`, `fixed` and debut releases.

* Intent files may key a package by directory with `./dir` keys.
* `Ledger` tracks consumption in three states, and `PendingChangesets.unconsumed` and `laneConsumed` read it.
* `PlannedRelease.causes` explains why each package is released, and carries the directory in pnpm mode.
* `VersioningError` reports the pnpm planner's failure codes, and `VersioningCheck` validates a `versioning` block.
* `RegistryVersions.layerFrom` builds the registry-version lookup from an `NpmConfig`, requiring `NpmRegistry`. `ReleasePlan.read` reads it optionally, so it never appears in `R`: provide it whenever the plan feeds a publish, or no release debuts.
* In a pnpm-native repository, a `.changeset/config.json` that is not JSON or has a malformed value plans as the defaults, as a missing one does, because pnpm never reads the file.
