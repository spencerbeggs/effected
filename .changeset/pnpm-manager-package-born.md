---
"@effected/pnpm": minor
---

## Features

### Initial release

`@effected/pnpm` is the kit's pnpm package: everything that is specifically pnpm's lives here, so the packages that only need npm or workspace facts no longer carry it.

### Settings and release-age gate

* `PnpmSettings` models `pnpm-workspace.yaml` settings, with a typed `versioning()` accessor for the `versioning` block. It moved here from `@effected/workspaces`.
* `ReleaseAgeGate` and `PartialReleaseAgeGate` moved here from `@effected/npm`.
* `VersioningConfig` and `Epic` describe pnpm-native versioning, `OverrideKey` parses override keys, and `PeerDependencyRules` models `peerDependencyRules` with a `.empty` value.
* `PnpmMatcher` matches package names the way pnpm's settings do.
* `PnpmWorkspaceFile` edits `pnpm-workspace.yaml` while preserving comments and layout.

### Lockfile documents

`PnpmLockDocument`, `PnpmEnvDocument` and `PnpmExtension` model pnpm's lockfile and env-lockfile documents.

### Registry and network view

`PnpmNpmConfig` reads pnpm 12's registry, proxy and TLS settings as an `NpmConfig`. `@effected/npm` is a required peer dependency, so the `NpmConfig` it returns is the copy the caller's `NpmHttpClient` and `NpmRegistry` take. Values that come from the environment and that pnpm 12 refuses are refused here too, as `untrusted-env`.

### Settings catalog

The `./settings` subpath exports `PnpmSettingsCatalog`, the catalog of pnpm 12.20.0's settings, re-derived from pnpm's source.
