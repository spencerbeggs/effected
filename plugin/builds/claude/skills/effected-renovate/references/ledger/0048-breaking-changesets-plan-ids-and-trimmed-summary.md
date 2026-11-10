---
id: "0048"
title: "PlannedRelease.changesets lists changeset ids instead of file names, and PendingChangeset.summary is trimmed"
kind: breaking
shows: behavioural
applies:
  "@effected/changesets": ">=0.3.0"
detect: ["\\.changesets([^A-Za-z]|$)", "\\\\\\.md\\$/", "\\.summary\\.trim\\("]
changesets: ["changesets-release-application"]
---

This applies to a repository that reads a `ReleasePlan` or a `PendingChangeset` from `@effected/changesets`. Both changes keep their types, so the compiler finds neither: only a test or a run shows them.

- **A release's `changesets` holds changeset ids now**, as `@changesets/get-release-plan` lists them: the file name without `.md`, and `pre/<name>` for one under `.changeset/pre/`. It held file names with `.md` before.
  - Code that stripped `.md` from these entries (`replace(/\.md$/, "")`) is now a no-op. Drop the strip.
  - Code that matched these entries against a changeset's `file` now matches nothing. Match against the new `PendingChangeset.id` getter instead.
  - `ReleasePlan.changesets` still holds `PendingChangeset`s, and their `file` is unchanged, so file IO (deleting, moving) keeps using `file`.
- **`PendingChangeset.summary` and `ParsedChangeset.summary` are trimmed**, as `@changesets/parse` trims them. A `.trim()` you added is now redundant and can stay or go. Code that relied on the leading blank line or the trailing newline (a printer re-joining a summary to its front matter) must add them back.

Check the installed `.d.ts` for the exact shapes. Verify by planning a fixture with one changeset and one consumed `pre/` changeset, and asserting a release lists `name` and `pre/name` with no `.md`. Then read a changeset whose summary has surrounding blank lines and assert they are gone.
