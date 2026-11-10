---
id: "0042"
title: "ChangesetConfig models changelog and snapshot, so neither is on extra any more"
kind: breaking
shows: behavioural
applies:
  "@effected/changesets": ">=0.3.0"
detect: ["extra(\\.|\\[[\"'])(changelog|snapshot)"]
changesets: ["changesets-release-application"]
---

This applies to code that reads `ChangesetConfig`. It now decodes `changelog` and `snapshot` as fields of their own, and they are no longer copied onto `extra`. Code that read `config.extra.changelog` or `config.extra.snapshot` (or their bracket forms) now reads `undefined` there. `extra` is a record of `unknown`, so the old read still compiles and the compiler finds none of these: go through every hit.

- Read `config.changelog` instead. It is the file's value as written: `false`, a module id string, or a `[moduleId, options]` pair. It defaults to `"@changesets/cli/changelog"`. It is not normalised: where `@changesets/config` turns a bare id into `[id, null]`, you see the string, so branch on `typeof` before indexing it.
- Read `config.snapshot` instead. It is `{ useCalculatedVersion, prereleaseTemplate? }`, `useCalculatedVersion` defaulting to `false` and `prereleaseTemplate` absent unless the file sets one. Delete any hand-written decoding and defaulting of these keys.
- The decode now refuses what `@changesets/config` refuses for these keys, such as `changelog: true` or an empty `prereleaseTemplate`, with `ChangesetConfigError`. A config that ran before and holds one of those now fails to read.
- `ChangesetConfig.make` fills both fields with their defaults, so existing `make` calls compile unchanged.

Check the installed `.d.ts` for the exact field types. Verify by reading a real `.changeset/config.json` and asserting both fields.
