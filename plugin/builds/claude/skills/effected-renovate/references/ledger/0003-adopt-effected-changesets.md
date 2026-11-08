---
id: "0003"
title: "@effected/changesets reads changeset files, .changeset/config.json and the release plan"
kind: adopt
shows: none
applies:
  "@effected/changesets": ">=0.1.0"
  "@effected/plugin": ">=0.3.0"
changesets: ["steady-ledgers-plan", "faithful-plans-match"]
---

Offer this to the user; never apply it unasked. It replaces hand-rolled front-matter splits and readers of `changeset status --output`. The kit's own `catalog:sync` moved to it.

- **`ChangesetFile`** parses one file to a `ParsedChangeset`, in a sync form and an Effect form.
- **`PendingChangesets`** reads `.changeset/` to a list of `PendingChangeset`, in a sync form and an Effect form.
- **`ChangesetConfig`** decodes `.changeset/config.json`. Keys it does not model are kept on `extra`.
- **`ReleasePlan.read`** works out what the pending set releases, as `PlannedRelease` values, including packages reached only as dependents, plus the `changesets` the plan used and its `preState`. `ReleasePlan.assemble` is the pure form. `fixed` and `linked` groups and `pre` and `exit` modes plan as changesets plans them.
- **`ChangesetLint`** on the `@effected/changesets/lint` subpath holds the CSH001 to CSH005 changeset rules, runnable through `@effected/markdown-lint`'s `MarkdownLint` or as markdownlint-cli2 custom rules. `@effected/markdown` and `@effected/markdown-lint` are optional peers needed only there.

The planner is held to `@changesets/get-release-plan` as a test oracle over fixture workspaces, and its own documented divergences are the exceptions. `none` entries are accepted: they name a package and move no version. A single-package repository is planned.

Check two things before offering it. Reading needs `FileSystem` and `Path` from core in `R`, and `ReleasePlan.read` also needs `WorkspaceDiscovery`. Snapshot releases are a flag of `changeset version`, not a repository state, so they are outside the plan; a version changesets cannot bump, such as `=1.2.0`, fails typed where changesets itself crashes or plans no version.

Nothing here writes a changeset, versions a package or publishes one. Read the installed `.d.ts` for the exact shapes.
