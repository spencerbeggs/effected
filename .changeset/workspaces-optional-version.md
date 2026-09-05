---
"@effected/workspaces": minor
---

## Features

### `WorkspacePackage.version` is optional

A workspace member whose `package.json` declares no `version` is now discovered, with `version` absent, matching what pnpm accepts for a private package. Previously the async surface failed the whole listing with `missingVersion` and the sync facade silently dropped the member, so a version-less monorepo root read as "no workspace at all".

- `WorkspaceDiscoveryError.kind` no longer includes `"missingVersion"`. A manifest whose `version` is present but not a string, or present but empty, reports `"invalidShape"`; only absence is tolerated.
- `WorkspaceResolver.versionOf` fails typed with `DependencyResolutionError` for a member that declares no version; `Option.none()` still means "not a workspace member".
- `getWorkspacePackagesSync` accepts an `onSkip` callback receiving a `WorkspaceDiscoverySkip` (`root`, `path`, `kind`, `cause`) for every manifest it cannot use, using the same kind vocabulary the async surface fails with, so a skip is never silent.

## Breaking Changes

- `WorkspacePackage.version` is `string | undefined`; a read site that assumed a string is a compile error.
- An exhaustive match over `WorkspaceDiscoveryError.kind` must drop the `"missingVersion"` arm.
- A `"version": ""` manifest, previously a `missingVersion` failure or a silent skip, is now rejected as `"invalidShape"` on both surfaces.
- Listings can grow: version-less roots and members now appear in `listPackages()` and `getWorkspacePackagesSync` results.
