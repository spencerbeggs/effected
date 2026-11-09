---
id: "0043"
title: "ReleasePlan plans snapshot releases, replacing a direct call to @changesets/assemble-release-plan"
kind: adopt
shows: none
applies:
  "@effected/changesets": ">=0.3.0"
detect: ["@changesets/assemble-release-plan", "assembleReleasePlan"]
changesets: ["changesets-release-application"]
---

Offer this to the user; never apply it unasked. It fits code that calls `@changesets/assemble-release-plan` itself only to pass the snapshot argument that `getReleasePlan` never takes, the way `changeset version --snapshot` does.

- Pass `snapshot: { tag?, commit?, timestamp, useCalculatedVersion?, prereleaseTemplate? }` to `ReleasePlan.read(root, { snapshot })` or `ReleasePlan.assemble`. `timestamp` is a `Date` you supply, so assembly reads no clock; pass `new Date()` at the edge for `changeset version` parity.
- The two overrides fall back to `config.snapshot`. `{tag}`, `{commit}`, `{commit-short}`, `{timestamp}` and `{datetime}` fill a template exactly as the changesets engine fills one.
- A snapshot in pre mode fails `SnapshotPreModeError`, as `changeset version` refuses one. A template using a placeholder with no value, or omitting `{tag}` while a tag is given, fails `SnapshotTemplateError`; the engine throws on both.
- An empty `tag` or `commit` is treated as absent, so the `|| undefined` guard for `--snapshot` with no value is no longer needed. Remove it.
- The plan records `snapshot: true`, which `ReleasePlan.edits` reads to pin dependents exactly.

Check the installed `.d.ts` for the exact shapes. Verify by planning a snapshot over a fixture and comparing each `newVersion` with what the engine gave for the same tag and time.
