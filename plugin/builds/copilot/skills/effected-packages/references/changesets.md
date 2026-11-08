# @effected/changesets

Changeset files, `.changeset/config.json` and the release plan as Effect schemas and pure functions. Nothing here writes a changeset, versions a package or publishes one. Boundary tier: the parsers and the planner are pure, while reading a repository needs core's `FileSystem` and `Path` in `R`, plus `WorkspaceDiscovery` from `@effected/workspaces` for `ReleasePlan.read`. Its runtime dependencies are `@effected/yaml`, `@effected/semver`, `@effected/glob` and `@effected/workspaces`. The changeset lint rules ship from the `@effected/changesets/lint` subpath, whose `@effected/markdown` and `@effected/markdown-lint` are optional peers the root never imports.

## Import

```ts
import { ChangesetConfig, ChangesetFile, PendingChangesets, PreState, ReleasePlan } from "@effected/changesets";
import { ChangesetLint } from "@effected/changesets/lint";
```

## Core API

- **`ChangesetFile.parse(text)` / `parseSync(text)`** — one changeset file to a `ParsedChangeset` (the packages and bump types from its front matter, plus the summary). `parseSync` returns a `Result` and needs no Effect runtime. Failure is `ChangesetParseError`.
- **`PendingChangesets.read(root)` / `readSync(root)`** — every pending changeset under `.changeset/` as `PendingChangeset` values, then those a pre-release consumed under `.changeset/pre/`, with `file` `pre/<name>.md`. `readSync` uses `node:fs`.
- **`ChangesetConfig.read(root)`** — the decoded config. Keys it does not model are kept on `extra`, and the boolean form of `privatePackages` is accepted. Failure is `ChangesetConfigError`.
- **`PreState.read(root)`** — `.changeset/pre.json` as `Option<PreState>` (`mode: "pre" | "exit"`, `tag`); `Option.none()` outside pre-release mode. It never rewrites the file.
- **`ReleasePlan.read(root)`** — discovers the workspace, reads config, changesets and `pre.json` and plans: a `ReleasePlan` whose `releases` are `PlannedRelease` values (`name`, `type`, `oldVersion`, `newVersion`, `changesets`). The plan also carries `changesets` (what it was made from, consumed ones left out in pre mode) and `preState`. **`ReleasePlan.assemble({ packages, changesets, config, pre? })`** is the pure core and returns a `Result`.
- **`ChangesetLint`** (from `/lint`) — the style rules CSH001 to CSH005 as `@effected/markdown-lint` `LintRule`s: `ChangesetLint.rules` for `MarkdownLint.lint` or `MarkdownlintAdapter.rules` (markdownlint-cli2), each rule as a static, and `ChangesetLint.lint(text)`. Verdicts, messages and lines are savvy-web/systems' markdownlint rules': top-level blocks only, and heading and cell text compared as written, so ``## `Features` `` is an unknown section.
- **`BumpType` and `ReleaseType`** — `patch | minor | major`, and `ReleaseType` adds `none`, which a changeset may write: it names the package and moves no version.
- **Errors** — `ChangesetParseError`, `ChangesetConfigError` (also a bad `pre.json`, and a package in two fixed or linked groups) and `UnknownPackageError`.

```ts
import { ReleasePlan } from "@effected/changesets";
import { Effect } from "effect";

// FileSystem, Path and WorkspaceDiscovery are provided once at the edge.
const plan = ReleasePlan.read("/repo").pipe(
  Effect.map((plan) => plan.releases.filter((release) => release.type !== "none")),
);
```

```ts
// .markdownlint-cli2.mjs
import { MarkdownlintAdapter } from "@effected/markdown-lint";
import { ChangesetLint } from "@effected/changesets/lint";

export default { customRules: MarkdownlintAdapter.rules(ChangesetLint.rules) };
```

## Rules the planner follows

`@changesets/get-release-plan` is the test oracle, held as a devDependency and never a dependency. These are the rules that are not obvious:

- A dependent of a bumped package always bumps `patch`.
- `privatePackages.version` defaults to `false`.
- `ignore` entries are globs, with `!` negation applied in order.
- A skipped package is still listed `none` when it depends on anything in the plan.
- A bump from a prerelease follows `semver.inc`: a `major` of `2.0.0-rc.1` is `2.0.0`.
- A version is read as node-semver reads it: a leading `v` is dropped (`v1.0.0` bumps to `1.0.1`, still reported as `v1.0.0`); a version changesets cannot bump, such as `=1.2.0` (only npm's loose parse reads it), fails `InvalidVersionError`.
- A single-package repository is planned, and `none` is accepted.
- A `fixed` group with any member releasing moves every unskipped member at the group's highest bump from the group's highest current version, and that version is each member's `oldVersion`. A `linked` group does the same for only its releasing members. Ripples and both group kinds repeat until nothing changes.
- In pre mode each bumped version gains `-<tag>.<n>` (a group shares its highest `n`), changesets under `.changeset/pre/` are left out, and a dependent is checked against the prerelease version. In exit mode those changesets count again and every numbered prerelease bumps at least `patch`.

## Gotchas

- Snapshot versions are not planned: `@changesets/get-release-plan` has no snapshot input to hold them to.
- A `pre.json` with no `tag` or an unknown `mode` fails `ChangesetConfigError`.
- An older-layout `pre.json` listing consumed changeset ids leaves them out in pre mode, and names them `pre/<file>` in exit mode. The oracle's first run counts them because it moves the files as it reads; the plan matches its later runs and writes nothing.
- A root listed in `packages:` beside other packages gets `UnknownPackageError` when a changeset names it.
- A package with no version is left out of the plan.
- The root entry is Node-only: `assemble` imports `posix` from `node:path`, and `readSync` uses `node:fs`. There is no synchronous `ChangesetConfig.read` or `ReleasePlan.read`.
