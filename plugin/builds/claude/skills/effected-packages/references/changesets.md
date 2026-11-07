# @effected/changesets

Changeset files, `.changeset/config.json` and the release plan as Effect schemas and pure functions. Nothing here writes a changeset, versions a package or publishes one. Boundary tier: the parsers and the planner are pure, while reading a repository needs core's `FileSystem` and `Path` in `R`, plus `WorkspaceDiscovery` from `@effected/workspaces` for `ReleasePlan.read`. Its runtime dependencies are `@effected/yaml`, `@effected/semver`, `@effected/glob` and `@effected/workspaces`.

## Import

```ts
import { ChangesetConfig, ChangesetFile, PendingChangesets, ReleasePlan } from "@effected/changesets";
```

## Core API

- **`ChangesetFile.parse(text)` / `parseSync(text)`** — one changeset file to a `ParsedChangeset` (the packages and bump types from its front matter, plus the summary). `parseSync` returns a `Result` and needs no Effect runtime. Failure is `ChangesetParseError`.
- **`PendingChangesets.read(root)` / `readSync(root)`** — every pending changeset under `.changeset/` as `PendingChangeset` values. `readSync` uses `node:fs`.
- **`ChangesetConfig.read(root)`** — the decoded config. Keys it does not model are kept on `extra`, and the boolean form of `privatePackages` is accepted. Failure is `ChangesetConfigError`.
- **`ReleasePlan.read(root)`** — discovers the workspace, reads config and changesets and plans: a list of `PlannedRelease` (`name`, `type`, `oldVersion`, `newVersion`, `changesets`). **`ReleasePlan.assemble({ packages, changesets, config })`** is the pure core and returns a `Result`.
- **`BumpType` and `ReleaseType`** — `patch | minor | major`, and `ReleaseType` adds `none`, which a changeset may write: it names the package and moves no version.
- **Errors** — `ChangesetParseError`, `ChangesetConfigError`, `UnsupportedChangesetModeError` and `UnknownPackageError`.

```ts
import { ReleasePlan } from "@effected/changesets";
import { Effect } from "effect";

// FileSystem, Path and WorkspaceDiscovery are provided once at the edge.
const plan = ReleasePlan.read("/repo").pipe(
  Effect.map((releases) => releases.filter((release) => release.type !== "none")),
);
```

## Rules the planner follows

`@changesets/get-release-plan` is the test oracle, held as a devDependency and never a dependency. These are the rules that are not obvious:

- A dependent of a bumped package always bumps `patch`.
- `privatePackages.version` defaults to `false`.
- `ignore` entries are globs, with `!` negation applied in order.
- A skipped package is still listed `none` when it depends on anything in the plan.
- A bump from a prerelease follows `semver.inc`: a `major` of `2.0.0-rc.1` is `2.0.0`.
- A single-package repository is planned, and `none` is accepted.

## Gotchas

- A non-empty `fixed` or `linked` group, and `.changeset/pre.json`, fail `UnsupportedChangesetModeError`; the oracle plans them.
- A root listed in `packages:` beside other packages gets `UnknownPackageError` when a changeset names it.
- A package with no version is left out of the plan.
- The root entry is Node-only: `assemble` imports `posix` from `node:path`, and `readSync` uses `node:fs`. There is no synchronous `ChangesetConfig.read` or `ReleasePlan.read`.
