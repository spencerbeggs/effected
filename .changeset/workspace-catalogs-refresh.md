---
"@effected/workspaces": minor
---

## Features

### `WorkspaceCatalogs.refresh()`

An explicit memoization boundary on the catalog assembly. The service's single assembly pass — one root discovery, one inline read, one config-dependency hook replay — is memoized indefinitely, so every reader (`set`, `resolveSpecifier`, `releaseAgeGate`, `peerDependencyRules`, `importerVersions`) answers from the workspace as it stood at the first read. A tool that **mutates the workspace mid-run** — installs, bumps a config dependency, regenerates the lockfile — needs both states: release-age gating wants the before-state, a post-install peer check the after-state, and one infinite memo cannot serve both. `refresh()` discards the memoized assembly so the **next** read re-assembles (the same single read and hook replay) over the post-mutation workspace:

```ts
const catalogs = yield* WorkspaceCatalogs;
const gate = yield* catalogs.releaseAgeGate(); // pre-install state, memoized
// ... install, bump a config dependency, regenerate the lockfile ...
yield* catalogs.refresh();
const rules = yield* catalogs.peerDependencyRules(); // post-install state
```

Without the boundary, a post-install peer check judges the new lockfile against the pre-bump `peerDependencyRules` and reports rows the bumped plugin's `allowedVersions` suppress. `refresh` is unconditional and infallible — the memo was already success-only (a failed or interrupted assembly retries by itself), so it exists solely to discard a successful assembly that mutation has made stale; calling it before any read is harmless.

On the `makeTest` double, `refresh` defaults to `Effect.void` honestly — the double holds no memo, so "drop the memoized assembly" is genuinely a no-op (the stubs answer fresh on every call already), mirroring `WorkspaceDiscovery.makeTest`'s `refresh`.
