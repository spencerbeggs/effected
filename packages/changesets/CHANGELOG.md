# @effected/changesets

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
