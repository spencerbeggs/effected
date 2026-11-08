---
"@effected/changesets": minor
---

## Features

### Release planning

`fixed` and `linked` groups and `pre` and `exit` modes plan as `@changesets/get-release-plan` does. `ReleasePlan` exposes `changesets` and `preState`, `PendingChangesets.read` also returns the `.changeset/pre/` entries, and `ChangesetConfig.read` no longer fails on `pre.json`. A `v1.0.0` version is normalised as node-semver does.

### `./lint` subpath

`@effected/changesets/lint` ships `ChangesetLint`, the CSH001–CSH005 rules as a custom rule for MarkdownLint and markdownlint-cli2, matching the markdownlint engine. `@effected/markdown` and `@effected/markdown-lint` are optional peers of this subpath only.

## Bug Fixes

* A version such as `=1.2.0`, which changesets cannot bump, fails typed

## Breaking Changes

`UnsupportedChangesetModeError` is removed: there is nothing to catch, because every mode now plans. Snapshot is a version-time flag outside the plan.
