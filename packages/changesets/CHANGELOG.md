# @effected/changesets

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/workspaces | dependency | updated | 0.45.0 | 0.46.0 |

## 0.4.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.20.0 | 0.21.0 |
| @effected/markdown | dependency | updated | 0.28.0 | 0.29.0 |
| @effected/markdown-lint | dependency | updated | 0.1.1 | 0.2.0 |
| @effected/semver | dependency | updated | 0.23.0 | 0.24.0 |
| @effected/workspaces | dependency | updated | 0.44.2 | 0.45.0 |
| @effected/yaml | dependency | updated | 0.29.0 | 0.30.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.3.0

### Breaking Changes

#### `changelog` and `snapshot` leave `extra`

- `ChangesetConfig` now decodes `changelog` and `snapshot` as fields of their own, so neither is copied onto `extra` any more. Code that read `config.extra.changelog` or `config.extra.snapshot` reads `undefined` there, and the compiler does not flag it, because `extra` holds `unknown` values.

- Read `config.changelog`: `false`, a module id or a `[moduleId, options]` pair, as the file writes it. It defaults to `"@changesets/cli/changelog"`.

- Read `config.snapshot`: `{ useCalculatedVersion, prereleaseTemplate? }`, where `useCalculatedVersion` defaults to `false`.

- Decoding accepts every shape `@changesets/config` accepts for the two keys, and refuses `changelog: true` or an empty `prereleaseTemplate` with `ChangesetConfigError`, as it does. One difference is deliberate: the options element of a `changelog` pair is carried as `unknown`, so `["x", 5]` and `["x", "s"]` decode here though `@changesets/config` rejects them, and `["x", []]` stays as written where it gives `["x", {}]`. Validating the options is the generator's job.

- `ChangesetConfig.make` fills both fields with their defaults, so existing calls compile unchanged.

#### The lint subpath ships style-neutral rules

- `@effected/changesets/lint` no longer ships savvy-web's changeset house style, rules CSH001 to CSH005. That style belongs to savvy-web, and its silk provides those rules. `ChangesetLint.rules` and the five rule statics are removed. `ChangesetLint.lint(text)` now runs only the new defaults, so a call that relied on it for the style rules stops reporting them.

- `ChangesetLint.defaults` holds rules that are right under any style. They check only what the changesets tool itself refuses a file for, and they agree with `@changesets/parse`:

  - `CF001`: the front matter is present, parses as YAML, and is a mapping;
  - `CF002`: each key names a package;
  - `CF003`: each value is `major`, `minor`, `patch` or `none`.

- `ChangesetLint.knownPackages(names)` adds `CF004`, which checks that each named package exists in the workspace.

- `ChangesetLint.lint(text, { rules, packages, defaults })` runs the defaults first, then `CF004` when `packages` is given, then your own rules. `defaults` replaces the default set.

- Migrate by passing your house rules through `rules`, or to `MarkdownlintAdapter.rules` beside `ChangesetLint.defaults`.

#### `PlannedRelease.changesets` lists changeset ids

- A release's `changesets` now holds each changeset's **id**, as `@changesets/get-release-plan` lists it: the file name without `.md`, and `pre/<name>` for a changeset under `.changeset/pre/`. It held file names with `.md` before. The type is still `ReadonlyArray<string>`, so the compiler flags nothing.

- Code that stripped `.md` from these entries can drop the strip; code that compared them with file names compares with `PendingChangeset.id` instead.

- `PendingChangeset` gains an `id` getter, the same id, so a plan's changesets match its releases without string handling.

- `ReleasePlan.changesets` still holds the `PendingChangeset`s, whose `file` is unchanged.

#### `PendingChangeset.summary` is trimmed

- `ChangesetFile.parse`, `parseSync` and `PendingChangesets.read` trim the summary, as `@changesets/parse` does. Leading blank lines and trailing newlines are gone; a caller that compared or printed the raw text sees the trimmed form.

### Features

#### Snapshot plans

- `ReleasePlan.assemble` and `ReleasePlan.read(root, { snapshot })` take a snapshot input of `{ tag?, commit?, timestamp, useCalculatedVersion?, prereleaseTemplate? }` and plan `changeset version --snapshot`'s versions. The oracle is `@changesets/assemble-release-plan`'s snapshot argument.

- Templates fill `{tag}`, `{commit}`, `{commit-short}`, `{timestamp}` and `{datetime}` as the changesets engine fills them, taking the time from `timestamp` rather than a clock.

- A snapshot in pre mode fails `SnapshotPreModeError`, as `changeset version` refuses one. A template placeholder with no value, or a tag with no `{tag}` to hold it, fails `SnapshotTemplateError`.

- An empty `tag` or `commit` is treated as absent.

- The plan records `snapshot: true`.

#### Planning from anywhere in the workspace

- `ReleasePlan.read(directory)` accepts any directory inside the workspace and climbs to the root, as `@changesets/get-release-plan` does: to the nearest workspace root, or for a repository with no workspace file to the nearest `package.json`. Before, a package subdirectory failed.
- `ReleasePlan.readWithContext(directory)` reads the same plan and returns a `ReleaseContext` of `{ root, plan, packages, config }`. `packages` is every package discovery lists, the root or lone package included, so `ReleasePlan.edits(plan, { packages, config })` and `Changelog.entry` take it directly.
- `WorkspaceDiscovery` memoizes each root's packages. A long-lived host that plans again after applying a release calls its `refreshIn(root)` first.

#### Release application as data

- `ReleasePlan.edits(plan, { packages, config })` returns a `Result` holding a `ReleaseEdits`: what `changeset version` writes, apart from changelogs, as data. The package still writes nothing.

- Each changed `package.json` gets a `ManifestEdit` with its new `version` and each rewritten `RangeEdit`. The edits follow `updateInternalDependencies`, the `workspace:` protocol forms, `onlyUpdatePeerDependentsWhenOutOfRange`, `bumpVersionsWithWorkspaceProtocolOnly`, and exact pins for a snapshot.

- The changeset files to delete, or in pre mode to move under `.changeset/pre/` as `ChangesetMove`s.

- The `pre.json` the release leaves behind: deleted on exit unless the plan is a snapshot, and otherwise unchanged. In pre mode no ids are added to it.

- A plan naming a package missing from `packages` fails `MissingPackageError`.

#### Changelogs

- `ChangelogFunctions`, `GetReleaseLine`, `GetDependencyReleaseLine` and the types they take are structurally identical to `@changesets/types`, so one changelog module loads under `@changesets/cli` and here.
- The data shapes those functions take are Effect schemas under the same names: `NewChangeset`, `NewChangesetWithCommit`, `ComprehensiveRelease`, `ModCompWithPackage`, `PackageJSON` and `VersionType`. A module can decode what it is handed, and `PackageJSON` keeps a manifest's unknown keys.
- `Changelog.entry` renders one release's block. It groups lines by bump type and adds the dependency-update lines, as `@changesets/apply-release-plan` does, and fails `ChangelogError` when the module's functions throw. You load the module and pass its functions.
- Each updated dependency's `packageJson` is its whole manifest as discovery read it (`WorkspacePackage.manifestRecord`), as `@changesets/cli` passes it, so a module can read any key.
- `Changelog.insert` places a block in a `CHANGELOG.md`'s text.

### Documentation

- `PlannedRelease.changesets` now documents when an empty list can occur: an empty list always means the package's own changeset did not set its bump. A non-empty list does not prove that it did. [#1318][#1318]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | dependency | updated | 0.22.0 | 0.23.0 |
| @effected/workspaces | dependency | updated | 0.44.1 | 0.44.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1318]: https://github.com/spencerbeggs/effected/pull/1318

## 0.2.0

### Features

#### A settled read of `.changeset/`

- `PendingChangesets.readSettled(root)` and `readSettledSync(root)` read `.changeset/` as `read` and `readSync` do, but a file that does not read or parse is reported instead of failing the whole read.

- They answer `{ changesets, failures }`, where each failure is `{ file, error }` and `error` is the typed `ChangesetParseError` or `PlatformError`

- Only a directory that cannot be listed fails them. A missing directory answers empty

- `read` and `readSync` are unchanged: keep them where versioning correctness depends on every file

- New exported types: `PendingChangesetFailure` and `SettledChangesets` [#1310][#1310]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown-lint | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/workspaces | dependency | updated | 0.44.0 | 0.44.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.1.0

### Breaking Changes

- `UnsupportedChangesetModeError` is removed: there is nothing to catch, because every mode now plans. Snapshot is a version-time flag outside the plan. [#1295][#1295]

### Features

#### Release planning

- `fixed` and `linked` groups and `pre` and `exit` modes plan as `@changesets/get-release-plan` does. `ReleasePlan` exposes `changesets` and `preState`, `PendingChangesets.read` also returns the `.changeset/pre/` entries, and `ChangesetConfig.read` no longer fails on `pre.json`. A `v1.0.0` version is normalised as node-semver does.

#### `./lint` subpath

- `@effected/changesets/lint` ships `ChangesetLint`, the CSH001–CSH005 rules as a custom rule for MarkdownLint and markdownlint-cli2, matching the markdownlint engine. `@effected/markdown` and `@effected/markdown-lint` are optional peers of this subpath only.

* Adds `@effected/changesets`, an Effect-native reader and planner for changesets
* `ChangesetFile` and `ParsedChangeset` parse a changeset file; `PendingChangesets` lists a repository's pending changesets, in both Effect and synchronous forms
* `ChangesetConfig` reads `.changeset/config.json`
* `ReleasePlan.assemble` and `ReleasePlan.read` compute the release plan, including the ripple bumps for dependents, and single-package repositories are planned too
* `ReleaseType` includes `none`, so a changeset can name a package without releasing it
* The planner is checked against `@changesets/get-release-plan` as a test oracle [#1249][#1249]

### Bug Fixes

- A version such as `=1.2.0`, which changesets cannot bump, fails typed

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.19.0 | 0.20.0 |
| @effected/markdown | dependency | updated | 0.27.0 | 0.28.0 |
| @effected/markdown-lint | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/workspaces | dependency | updated | 0.43.0 | 0.44.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1249]: https://github.com/spencerbeggs/effected/pull/1249

[#1295]: https://github.com/spencerbeggs/effected/pull/1295
