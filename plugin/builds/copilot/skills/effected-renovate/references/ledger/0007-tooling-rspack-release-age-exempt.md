---
id: "0007"
title: "@effected/pnpm-plugin-effected exempts @rspack/* from minimumReleaseAge"
kind: tooling
shows: none
applies:
  "@effected/pnpm-plugin-effected": ">=0.26.1"
detect: ["^[[:space:]]*-[[:space:]]*[\"']?@rspack/"]
changesets: ["rspack-release-age-exempt"]
closes: ["spencerbeggs/effected#1322"]
---

The catalog plugin's `minimumReleaseAgeExclude` now lists `@rspack/*` beside `@rsbuild/*`, because the rspack packages publish in lockstep with `@rsbuild/core`. A fresh rsbuild release no longer fails to resolve while its rspack dependencies are still quarantined.

Where the search matched an `@rspack/` item, check that it sits under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. If it does, delete it: the plugin covers `@rspack/core` and every `@rspack/binding*` package. Leave an `@rspack/` item under any other key alone. Delete the list itself if it is left empty.

Verify with `pnpm install --frozen-lockfile`, which must resolve without a release-age refusal.
