---
"@effected/changesets": minor
---

## Features

* Adds `@effected/changesets`, an Effect-native reader and planner for changesets
* `ChangesetFile` and `ParsedChangeset` parse a changeset file; `PendingChangesets` lists a repository's pending changesets, in both Effect and synchronous forms
* `ChangesetConfig` reads `.changeset/config.json`
* `ReleasePlan.assemble` and `ReleasePlan.read` compute the release plan, including the ripple bumps for dependents, and single-package repositories are planned too
* `ReleaseType` includes `none`, so a changeset can name a package without releasing it
* The planner is checked against `@changesets/get-release-plan` as a test oracle
