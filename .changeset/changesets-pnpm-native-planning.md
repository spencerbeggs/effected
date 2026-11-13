---
"@effected/changesets": minor
---

## Breaking Changes

* `ReleasePlan.read` detects the release manager first. A malformed `versioning` block now fails a changesets-only workspace with `PnpmSettingsError`.
* `AmbiguousPackageError` is keyed by `packageName`, and `changeset` is optional on it.
* `EpicOutOfBand` has a required `major` field.
* Edits and floors refuse a plan that releases two same-named projects.

## Features

### pnpm-native release planning

Releases can be planned from pnpm's own `versioning` settings, closing #1316. `ReleaseManager` detects which system a workspace uses. The planner supports lanes, epics, `maxBump`, `ignore`, `fixed` and debut releases.

* Intent files may key a package by directory with `./dir` keys.
* `Ledger` tracks consumption in three states, and `PendingChangesets.unconsumed` and `laneConsumed` read it.
* `PlannedRelease.causes` explains why each package is released, and carries the directory in pnpm mode.
* `VersioningError` reports the pnpm planner's failure codes, and `VersioningCheck` validates a `versioning` block.
* `RegistryVersions.layerFrom` builds the registry-version lookup from a supplied source.
