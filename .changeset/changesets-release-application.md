---
"@effected/changesets": minor
---

## Breaking Changes

### `changelog` and `snapshot` leave `extra`

`ChangesetConfig` now decodes `changelog` and `snapshot` as fields of their own, so neither is copied onto `extra` any more. Code that read `config.extra.changelog` or `config.extra.snapshot` reads `undefined` there, and the compiler does not flag it, because `extra` holds `unknown` values.

* Read `config.changelog`: `false`, a module id or a `[moduleId, options]` pair, as the file writes it. It defaults to `"@changesets/cli/changelog"`.
* Read `config.snapshot`: `{ useCalculatedVersion, prereleaseTemplate? }`, where `useCalculatedVersion` defaults to `false`.
* Decoding accepts every shape `@changesets/config` accepts for the two keys, and refuses what it refuses, such as `changelog: true` or an empty `prereleaseTemplate`, with `ChangesetConfigError`.
* `ChangesetConfig.make` fills both fields with their defaults, so existing calls compile unchanged.

### The lint subpath ships style-neutral rules

`@effected/changesets/lint` no longer ships savvy-web's changeset house style, rules CSH001 to CSH005. That style belongs to savvy-web, and its silk provides those rules. `ChangesetLint.rules` and the five rule statics are removed. `ChangesetLint.lint(text)` now runs only the new defaults, so a call that relied on it for the style rules stops reporting them.

* `ChangesetLint.defaults` holds rules that are right under any style. They check only what the changesets tool itself refuses a file for, and they agree with `@changesets/parse`:
  * `CF001`: the front matter is present, parses as YAML, and is a mapping;
  * `CF002`: each key names a package;
  * `CF003`: each value is `major`, `minor`, `patch` or `none`.
* `ChangesetLint.knownPackages(names)` adds `CF004`, which checks that each named package exists in the workspace.
* `ChangesetLint.lint(text, { rules, packages, defaults })` runs the defaults first, then `CF004` when `packages` is given, then your own rules. `defaults` replaces the default set.
* Migrate by passing your house rules through `rules`, or to `MarkdownlintAdapter.rules` beside `ChangesetLint.defaults`.

## Features

### Snapshot plans

`ReleasePlan.assemble` and `ReleasePlan.read(root, { snapshot })` take a snapshot input of `{ tag?, commit?, timestamp, useCalculatedVersion?, prereleaseTemplate? }` and plan `changeset version --snapshot`'s versions. The oracle is `@changesets/assemble-release-plan`'s snapshot argument.

* Templates fill `{tag}`, `{commit}`, `{commit-short}`, `{timestamp}` and `{datetime}` as the changesets engine fills them, taking the time from `timestamp` rather than a clock.
* A snapshot in pre mode fails `SnapshotPreModeError`, as `changeset version` refuses one. A template placeholder with no value, or a tag with no `{tag}` to hold it, fails `SnapshotTemplateError`.
* An empty `tag` or `commit` is treated as absent.
* The plan records `snapshot: true`.

### Release application as data

`ReleasePlan.edits(plan, { packages, config })` returns a `Result` holding a `ReleaseEdits`: what `changeset version` writes, apart from changelogs, as data. The package still writes nothing.

* Each changed `package.json` gets a `ManifestEdit` with its new `version` and each rewritten `RangeEdit`. The edits follow `updateInternalDependencies`, the `workspace:` protocol forms, `onlyUpdatePeerDependentsWhenOutOfRange`, `bumpVersionsWithWorkspaceProtocolOnly`, and exact pins for a snapshot.
* The changeset files to delete, or in pre mode to move under `.changeset/pre/` as `ChangesetMove`s.
* The `pre.json` the release leaves behind: deleted on exit unless the plan is a snapshot, and otherwise unchanged. In pre mode no ids are added to it.
* A plan naming a package missing from `packages` fails `MissingPackageError`.

### Changelogs

* `ChangelogFunctions`, `GetReleaseLine`, `GetDependencyReleaseLine` and the types they take are structurally identical to `@changesets/types`, so one changelog module loads under `@changesets/cli` and here.
* The data shapes those functions take are Effect schemas under the same names: `NewChangeset`, `NewChangesetWithCommit`, `ComprehensiveRelease`, `ModCompWithPackage`, `PackageJSON` and `VersionType`. A module can decode what it is handed, and `PackageJSON` keeps a manifest's unknown keys.
* `Changelog.entry` renders one release's block. It groups lines by bump type and adds the dependency-update lines, as `@changesets/apply-release-plan` does, and fails `ChangelogError` when the module's functions throw. You load the module and pass its functions.
* `Changelog.insert` places a block in a `CHANGELOG.md`'s text.

## Documentation

`PlannedRelease.changesets` now documents when an empty list can occur: an empty list always means the package's own changeset did not set its bump. A non-empty list does not prove that it did.
