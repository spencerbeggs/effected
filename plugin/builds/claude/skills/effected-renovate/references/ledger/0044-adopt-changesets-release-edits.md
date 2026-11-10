---
id: "0044"
title: "ReleasePlan.edits computes what changeset version writes, replacing @changesets/apply-release-plan's manifest and changeset side"
kind: adopt
shows: none
applies:
  "@effected/changesets": ">=0.3.0"
detect: ["@changesets/apply-release-plan", "applyReleasePlan", "@manypkg/get-packages"]
changesets: ["changesets-release-application"]
---

Offer this to the user; never apply it unasked. It fits code that runs `@changesets/apply-release-plan`, for real or against a temporary copy for a preview, and keeps `@manypkg/get-packages` and a translation back to the changesets `Config` only to feed it.

- `ReleasePlan.edits(plan, { packages, config })` returns a `Result` of `ReleaseEdits`. Pass every package `WorkspaceDiscovery.listPackagesIn` lists, the workspace root included, because the root's ranges are rewritten too.
- `manifests` holds one entry per `package.json` that changes, giving the new `version` and each rewritten range as `{ kind, dependency, from, to }`. `deleteChangesets` and `moveChangesets` are relative to `.changeset/`. `preState` is the `pre.json` the release leaves, absent when the file should be deleted.
- A preview renders the edits and writes nothing, so the temporary tree goes. An apply writes them. The package itself never writes.
- In pre mode a consumed changeset is moved to `.changeset/pre/` and `pre.json` is left unchanged: no ids are added to it, so do not look for any.
- CHANGELOG files are not in the edits; `Changelog` renders them. Formatting the written files is still yours.

Check the installed `.d.ts` for the exact shapes. Verify by applying the edits to a copy of a repository and diffing it against `changeset version` on another copy.
