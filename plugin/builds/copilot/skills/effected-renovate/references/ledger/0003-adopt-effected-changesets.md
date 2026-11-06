---
id: "0003"
title: "@effected/changesets reads changeset files, .changeset/config.json and the release plan"
kind: adopt
shows: none
applies:
  "@effected/changesets": ">=0.1.0"
changesets: []
---

Offer this to the user; never apply it unasked. It replaces hand-rolled front-matter splits and readers of `changeset status --output`. The kit's own `catalog:sync` moved to it.

- **`ChangesetFile`** parses one file to a `ParsedChangeset`, in a sync form and an Effect form.
- **`PendingChangesets`** reads `.changeset/` to a list of `PendingChangeset`, in a sync form and an Effect form.
- **`ChangesetConfig`** decodes `.changeset/config.json`. Keys it does not model are kept on `extra`.
- **`ReleasePlan.read`** works out what the pending set releases, as `PlannedRelease` values, including packages reached only as dependents. `ReleasePlan.assemble` is the pure form.

The planner is held to `@changesets/get-release-plan` as a test oracle over fixture workspaces, and its own documented divergences are the exceptions. `none` entries are accepted: they name a package and move no version. A single-package repository is planned.

Check two things before offering it. Reading needs `FileSystem` and `Path` from core in `R`, and `ReleasePlan.read` also needs `WorkspaceDiscovery`. A non-empty `fixed` or `linked` group, or a `.changeset/pre.json`, fails with `UnsupportedChangesetModeError` instead of planning, so a repository that uses those keeps its current reader.

Nothing here writes a changeset, versions a package or publishes one. Read the installed `.d.ts` for the exact shapes.
