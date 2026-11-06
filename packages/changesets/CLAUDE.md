# @effected/changesets

Changeset files, `.changeset/config.json` and the release plan as Effect schemas and pure functions. Nothing here writes a changeset, versions a package or publishes one.

**Tier: boundary.** The parsers and the planner are pure; reading a repository requires core's `FileSystem` and `Path` in `R`, plus `WorkspaceDiscovery` for `ReleasePlan.read`. Runtime deps are `@effected/yaml` (front matter), `@effected/semver` (ranges and bumps), `@effected/glob` (`ignore` patterns) and `@effected/workspaces` (packages and dependency edges).

**For the full design:** → `@./okf/modules/changesets.md`

Load when changing the public API, the package's dependency edges, or who consumes the plan.

## Module layout

- `BumpType.ts`: `BumpType` is `patch | minor | major`, and `ReleaseType` adds `none`, which a changeset may write: it names the package and moves no version.
- `ChangesetFile.ts`: `parseSync` and `parse` for one file, to `ParsedChangeset`.
- `PendingChangesets.ts`: `read` and `readSync` for `.changeset/`, to `PendingChangeset`.
- `ChangesetConfig.ts`: the decoded config and `read`. Keys it does not model are kept on `extra`. `read` also accepts the boolean form of `privatePackages`, which the class schema alone rejects.
- `ReleasePlan.ts`: `assemble` (pure, returns `Result`), `read` and `PlannedRelease`. Its class TSDoc lists the rules.
- `errors.ts`: `ChangesetParseError`, `ChangesetConfigError`, `UnsupportedChangesetModeError`, `UnknownPackageError`.

## The oracle rule

`@changesets/get-release-plan` is a devDependency and **the authority on what a plan is**. It must never reach `dependencies` or `peerDependencies`. `__test__/ReleasePlan.oracle.test.ts` runs both over the pnpm workspaces in `__test__/fixtures/` and requires the same `{ name, type, oldVersion, newVersion }`. When they disagree, the planner is wrong until shown otherwise: fix `assemble` and record the rule in `ReleasePlan`'s TSDoc.

The oracle's rules are not the obvious ones. These have each been written wrong once:

- A dependent always bumps `patch`. `updateInternalDependencies` does not set the bump.
- `privatePackages.version` defaults to `false`.
- `ignore` entries are globs, with `!` negation applied in order.
- A skipped package is still listed `none` when it depends on anything in the plan, and a `none` entry bumps nothing.
- A bump from a prerelease follows `semver.inc`, not `SemVerBump`: a `major` of `2.0.0-rc.1` is `2.0.0`.

The test's expected `name -> type` table is what stops a fixture agreeing with the planner about nothing. Every fixture's purpose is in `__test__/fixtures/README.md`. The oracle climbs past a root with no package patterns, so `single-package` is compared from a temporary copy outside this repository.

## Documented divergences

These are deliberate, and each is ruled or stated in TSDoc. Do not "fix" one without a new ruling.

**Refused where the oracle plans:**

- A non-empty `fixed` or `linked` group, and `.changeset/pre.json`: `UnsupportedChangesetModeError`.
- A root listed in `packages:` alongside other packages, for example `[".", "packages/*"]`: a changeset naming it gets `UnknownPackageError`.

**Planned where the oracle refuses:**

- A changeset mixing skipped and released packages.
- A public package depending on a skipped one.
- `privatePackages` with `tag` on and `version` off.
- `packages: []` and patterns matching nothing plan the root, because discovery cannot tell `packages: []` from an absent key.

**Answered differently:**

- A version-less package is left out of the plan. The oracle lists it with no versions, and `PlannedRelease` requires them.
- A catalog-only root nested in another workspace answers for itself. The oracle climbs to the enclosing workspace.

## Sync forms

`ChangesetFile.parseSync`, `PendingChangesets.readSync` and `ReleasePlan.assemble` run with no Effect runtime. `readSync` uses `node:fs`, and `assemble` imports `posix` from `node:path` to compare `workspace:` paths the way the oracle does, so the root entry is Node-only. There is no synchronous `ChangesetConfig.read` or `ReleasePlan.read`.

## Consumers

`lib/scripts/catalog-sync.ts` calls `ReleasePlan.read` as the default behind its `StatusRunner` seam, so a change to `read` reaches `catalog:check` and `catalog:sync`. `@effected/bundler` is the first package consumer.

## Working here

```bash
pnpm exec vitest run --project @effected/changesets --coverage.enabled=false  # from the repo root
pnpm --filter @effected/changesets run types:check
pnpm build --filter @effected/changesets
```

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*`, never `expect`. In-memory tests use `@effected/memfs`. The oracle test runs over the real filesystem because the oracle does. Never run `pnpm install` inside a fixture.

The bundler's default config carries one narrow API Extractor suppression: `{ messageId: "ae-forgotten-export", pattern: "_base" }`, covering the heritage symbols synthesized by inline class factories. Never widen it. `package.json` stays `"private": true`; the bundler emits the publishable manifest.
