# @effected/changesets

Changeset files, `.changeset/config.json` and the release plan as Effect schemas and pure functions. Nothing here writes a changeset, versions a package or publishes one: what `changeset version` would write comes back as data, and the caller does the IO. Boundary tier: the parsers and the planner are pure, while reading a repository needs core's `FileSystem` and `Path` in `R`, plus `WorkspaceDiscovery` from `@effected/workspaces` for `ReleasePlan.read`. Its runtime dependencies are `@effected/yaml`, `@effected/semver`, `@effected/glob` and `@effected/workspaces`. The changeset front-matter lint rules ship from the `@effected/changesets/lint` subpath, whose `@effected/markdown` and `@effected/markdown-lint` are optional peers the root never imports.

## Import

```ts
import { Changelog, ChangesetConfig, ChangesetFile, Ledger, PendingChangesets, PreState, RegistryVersions, ReleaseManager, ReleasePlan, VersioningCheck } from "@effected/changesets";
import { ChangesetLint } from "@effected/changesets/lint";
```

## Core API

- **`ChangesetFile.parse(text)` / `parseSync(text)`** — one changeset file to a `ParsedChangeset` (the packages and bump types from its front matter, plus the summary). `parseSync` returns a `Result` and needs no Effect runtime. Failure is `ChangesetParseError`.
- **`PendingChangesets.read(root)` / `readSync(root)`** — every pending changeset under `.changeset/` as `PendingChangeset` values, then those a pre-release consumed under `.changeset/pre/`, with `file` `pre/<name>.md`. `readSync` uses `node:fs`.
- **`ChangesetConfig.read(root)`** — the decoded config. `changelog` (`false`, a module id, or `[moduleId, options]`, kept as written, default `"@changesets/cli/changelog"`) and `snapshot` (`{ useCalculatedVersion, prereleaseTemplate? }`) are fields; keys it does not model are kept on `extra`. The boolean form of `privatePackages` is accepted. Failure is `ChangesetConfigError`.
- **`ReleaseManager.detect(root)`** — `"pnpm"` when `pnpm-workspace.yaml` has a `versioning` block or `.changeset/ledger.yaml` exists, `"changesets"` otherwise (needs `FileSystem` and `Path`; a `versioning` block that does not decode fails `PnpmSettingsError`). pnpm ignores `pre.json` and `config.json`, so their presence decides nothing. `ReleasePlan.read` passes the answer to `assemble` as `manager`.
- **`Ledger.read(root)`** — pnpm's `.changeset/ledger.yaml` as `Option<Ledger>` (`LedgerError` when malformed); `Ledger.consumption` answers `"none" | "prerelease-only" | "stable"` for an intent. `PendingChangesets.unconsumed` and `laneConsumed` read it.
- **`VersioningCheck.check(packages, versioning)`** — `pnpm change check` as a `Result` of every `EpicOutOfBand` and `FixedOutOfStep` violation (an epic member outside its lead's band, a fixed group not sharing one version); a `versioning` block pnpm refuses fails `VersioningError` first.
- **`RegistryVersions` and `RegistryVersions.layerFrom(config)`** — the first-release seam: `published(name, version)` is whether the registry has exactly that version. `layerFrom(npmConfig)` builds it over `NpmRegistry`, routing each package to its own registry and credential via `NpmConfig.targetFor`; bind the layer to a `const` once. `ReleasePlan.read` asks it for each public release when it is provided and plans a debut for a manifest version the registry lacks; a transport or status failure is `RegistryReadError`, never "unpublished". It is read with `Effect.serviceOption`, so it never appears in `R`: never provide only `WorkspaceDiscovery` and the platform to a pnpm-native repository and expect first releases — with no `RegistryVersions.layerFrom(config)` nothing debuts, a never-published `1.0.0` plans `1.1.0`, and the plan still succeeds.
- **`PreState.read(root)`** — `.changeset/pre.json` as `Option<PreState>` (`mode: "pre" | "exit"`, `tag`); `Option.none()` outside pre-release mode. It never rewrites the file.
- **`ReleasePlan.read(directory)`** — discovers the workspace, reads config, changesets and `pre.json` and plans: a `ReleasePlan` whose `releases` are `PlannedRelease` values (`name`, `type`, `oldVersion`, `newVersion`, `changesets`, the ids of the changesets naming the package). The plan also carries `changesets` (the `PendingChangeset`s it was made from, consumed ones left out in pre mode; each has `file` and `id`) and `preState`. `directory` may be any directory inside the workspace: the root is climbed to, as `@changesets/get-release-plan` climbs. **`ReleasePlan.readWithContext(directory)`** reads the same plan and returns a `ReleaseContext` of `{ root, plan, packages, config }`, the exact packages (root or lone package included) and config to hand `edits` and `Changelog.entry`. **`ReleasePlan.assemble({ packages, changesets, config, pre?, snapshot? })`** is the pure core and returns a `Result`.
- **Snapshot plans** — pass `snapshot: { tag?, commit?, timestamp, useCalculatedVersion?, prereleaseTemplate? }` to `assemble` or `ReleasePlan.read(root, { snapshot })` for `changeset version --snapshot`'s versions. `timestamp` is an input, so assembly reads no clock. Pre mode fails `SnapshotPreModeError`; a template placeholder with no value, or a tag with no `{tag}`, fails `SnapshotTemplateError`. An empty `tag` or `commit` is absent. The plan records `snapshot: true`.
- **`ReleasePlan.edits(plan, { packages, config })`** — what `changeset version` writes, as a `Result` of `ReleaseEdits`: `manifests` (each `ManifestEdit` with its new `version` and rewritten `RangeEdit`s), `deleteChangesets`, `moveChangesets` (pre mode) and the `preState` left (absent: delete `pre.json`). Pass every package including the root, as `WorkspaceDiscovery.listPackagesIn` lists them. Held to `@changesets/apply-release-plan` on disk.
- **`Changelog.entry(plan, release, functions, { packages, config, commits?, changelogOptions? })`** — an `Effect` of the release's CHANGELOG block (`Option.none()` for a `none` entry), as `@changesets/apply-release-plan` renders it; **`Changelog.insert(existing, block, name)`** places it in the file's text (`""` for a new file). You load the changelog module and pass its `ChangelogFunctions`; the package never resolves a module id. `ChangelogFunctions`, `GetReleaseLine`, `GetDependencyReleaseLine`, `NewChangesetWithCommit`, `ModCompWithPackage` and `VersionType` are structurally identical to `@changesets/types`, so one module loads under `@changesets/cli` and here. The data shapes are also schemas under the same names (`Schema.decodeUnknownResult(ModCompWithPackage)(value)`); `PackageJSON` is open and keeps unknown keys.
- **`ChangesetLint`** (from `/lint`) — style-neutral rules as `@effected/markdown-lint` `LintRule`s, checking only what the changesets tool refuses a file for: `CF001` front matter present, YAML, a mapping when not empty; `CF002` every key a package name; `CF003` every value `major | minor | patch | none`; `CF004` (`ChangesetLint.knownPackages(names)`) every key a workspace package. `ChangesetLint.defaults` is `CF001`–`CF003`; `ChangesetLint.lint(text, { packages?, rules?, defaults? })` runs them, `CF004` when `packages` is given, then your rules. No house style (section headings, summary layout) ships here: bring your own rules.
- **`BumpType` and `ReleaseType`** — `patch | minor | major`, and `ReleaseType` adds `none`, which a changeset may write: it names the package and moves no version.
- **pnpm-native plans** — under `manager: "pnpm"` the plan is pnpm's own: keyed by project directory (each `PlannedRelease` has a `dir`, `""` for the root, and `causes`), so a `./dir` changeset key names one of two same-named projects. A bare name that two projects publish fails `AmbiguousPackageError`, and the name-keyed readers (`ReleasePlan.edits`, `breakingFloors`, `releasesByName`) refuse a plan releasing two same-named projects the same way. pnpm's other refusals are one `VersioningError` whose `code` is pnpm's `ERR_PNPM_*`.
- **Errors** — `ChangesetParseError`, `ChangesetConfigError` (also a bad `pre.json`, and a package in two fixed or linked groups), `UnknownPackageError`, `SnapshotPreModeError`, `SnapshotTemplateError`, `MissingPackageError` (a plan naming a package the edits or changelog were not given) and `ChangelogError` (a changelog function threw or rejected).

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
import { houseRules } from "./lint/house-rules.mjs"; // your style's own LintRules

export default { customRules: MarkdownlintAdapter.rules([...ChangesetLint.defaults, ...houseRules]) };
```

```ts
import { Changelog, ReleasePlan } from "@effected/changesets";
import type { ChangelogFunctions } from "@effected/changesets";
import { Effect, Option } from "effect";

// The changelog module, imported by the caller from wherever config.changelog names it.
declare const changelogFunctions: ChangelogFunctions;
declare const readChangelog: (name: string) => string; // "" for a file that does not exist

// Apply a plan: the caller writes what the edits and changelog texts describe.
const program = Effect.gen(function* () {
  const { plan, packages, config } = yield* ReleasePlan.readWithContext("/repo");
  const edits = yield* Effect.fromResult(ReleasePlan.edits(plan, { packages, config }));
  const texts = new Map<string, string>();
  for (const release of plan.releases) {
    const block = yield* Changelog.entry(plan, release, changelogFunctions, { packages, config });
    if (Option.isSome(block)) {
      texts.set(release.name, Changelog.insert(readChangelog(release.name), block.value, release.name));
    }
  }
  return { edits, texts };
});
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

- **A lane prerelease publishes under `latest`.** Under pnpm-native planning a lane builds `X.Y.Z-<lane>.N`, but the prerelease segment does not choose a dist-tag: publish it with `--tag <tag>` (the lane's name is a natural tag) or consumers on `latest` receive it.
- **Only `workspace:` specs constrain a dependent under pnpm planning**: a plain range never ripples, a 1.x minor stays inside `workspace:^`, and devDependencies never ripple.

- Snapshot plans are held to `@changesets/assemble-release-plan`'s snapshot argument, which `getReleasePlan` never passes. Unlike that engine, pre mode is refused (as `changeset version` refuses it), and an empty tag or commit is no value rather than an empty one.
- Pre mode consumes a changeset by moving its file under `.changeset/pre/` (`moveChangesets`); `pre.json` is left unchanged and lists no ids.
- `PlannedRelease.changesets` lists changeset **ids**, as the oracle does: the file name without `.md`, and `pre/<name>` for one under `.changeset/pre/`. Use `PendingChangeset.id` to match a plan's changeset to a release; never strip `.md` yourself. `PendingChangeset.summary` is trimmed, as `@changesets/parse` trims it.
- `WorkspaceDiscovery` memoizes each root's packages for the layer's lifetime. A long-lived host (an MCP server) that plans again after applying a release calls `WorkspaceDiscovery`'s `refreshIn(root)` first, or it plans against the versions the release replaced.
- A changelog module's `packageJson` is the dependency's whole manifest (`WorkspacePackage.manifestRecord`), as `@changesets/cli` passes it.
- `workspace:*`, `workspace:^`, `workspace:~` and `workspace:` paths are never rewritten by `edits`, and a package outside the plan keeps its ranges even when the release leaves them.
- An empty `PlannedRelease.changesets` always means the package's own changeset did not set its bump (a ripple, a fixed member, or an exit completion). A non-empty one does not prove it did: a group or an exit can raise a package a changeset named only `none`.
- The lint defaults are held to `@changesets/parse`: a file it parses fails none of them. It accepts more than a strict linter would (an unanchored fence, an empty block or summary, any non-blank key), so never tighten a default rule.
- `Changelog.entry` hands a module the `packageJson` fields a `WorkspacePackage` carries, not the whole manifest. Formatting the written CHANGELOG is yours.
- A `pre.json` with no `tag` or an unknown `mode` fails `ChangesetConfigError`.
- An older-layout `pre.json` listing consumed changeset ids leaves them out in pre mode, and names them `pre/<file>` in exit mode. The oracle's first run counts them because it moves the files as it reads; the plan matches its later runs and writes nothing.
- A root listed in `packages:` beside other packages gets `UnknownPackageError` when a changeset names it.
- A package with no version is left out of the plan.
- The root entry is Node-only: `assemble` imports `posix` from `node:path`, and `readSync` uses `node:fs`. There is no synchronous `ChangesetConfig.read` or `ReleasePlan.read`.
