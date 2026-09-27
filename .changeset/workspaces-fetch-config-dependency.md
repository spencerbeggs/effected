---
"@effected/workspaces": minor
---

## Features

### Replay a config dependency version nobody installed

A snapshot diff across a config-dependency bump no longer fails on a fresh checkout (#842). The base side declares the old version, which neither `node_modules/.pnpm-config` nor the store holds. `ConfigDependencyHooks.layerSubprocess`, and so `Workspaces.layerWithGitAndConfigDependenciesSubprocess`, now fetches that version into the pnpm store.

The fetch is verified, fail-closed:

* pnpm 11 or 12 runs `install --frozen-lockfile` in a scratch workspace, which is removed afterwards. Its lockfile pins the integrity the declaring side recorded, so pnpm itself refuses a tarball that does not match.
* The integrity comes from the inline `<version>+<integrity>` spec when present, else from that side's `pnpm-lock.yaml` env preamble. `WorkspaceSnapshots.at(ref)` reads the lockfile at the ref, so the base side is checked against the base side's record.
* Two sources that disagree fail with `reason: "integrityMismatch"`. No source fails with `reason: "integrityUnavailable"`. Nothing is fetched in either case.
* A failed fetch fails with `reason: "fetchFailed"`, keeping the `pnpm add --config` remediation.
* The scratch workspace fetches through the workspace's own registry config. The root `.npmrc` (scoped registries, mirrors, auth) is copied in as-is, with `${NPM_TOKEN}`-style references left for pnpm to expand, and removed with the scratch. The root `pnpm-workspace.yaml`'s `registry` and `registries` keys are carried over too. Both come from the current checkout for either side of a diff; a base ref's `.npmrc` is not read through git.

The fetch writes to the first store the ladder searched, so the next replay finds the version there. `HookReplaySource` gains `"fetched"`, recorded in `replays[name].source` when the fetch rung answered.

The other replaying layers still do not fetch. A version they find nowhere now fails with `reason: "notInstalled"`, and the message names the ref that declared it and explains the base-side cause.

`ConfigDependencyHooksShape.inject` takes an optional fifth argument, `HookReplayContext`, carrying the declaring side's `lockfile` text and `ref`. `WorkspaceCatalogs` and `WorkspaceSnapshots` supply it. A custom implementation may ignore it.

## Bug Fixes

### The not-installed message no longer depends on a magic empty version

The replay ladder no longer uses an empty-string version to mean "this `package.json` carries no version". It now tracks that state as its own case, so no caller has to know the convention (part of #613). The error still reads "a package with no version". A manifest whose `version` is the empty string now counts as having no version too, so an empty declared version can no longer match it.
