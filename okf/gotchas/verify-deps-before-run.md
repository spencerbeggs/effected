---
type: Gotcha
title: After a workspace package is renamed, the next pnpm run installs before it runs the script
description: "pnpm's verifyDepsBeforeRun check sees a renamed workspace package as out of sync with the lockfile, so the first pnpm run of any script (lint, build, test) silently runs an install first and rewrites the lockfile and node_modules; it looks like the script changed them."
status: draft
stale_after: 2027-04-30T00:00:00Z
tags:
  - dx
  - deps
sources:
  - id: rename-observation
    resource: "feat/effect-4.1.1, 2026-10-31: renaming packages/pnpm-plugin-effect to packages/pnpm-plugin-effected made the next pnpm run auto-install on pnpm 12.16.1"
  - id: pnpm-setting
    resource: https://pnpm.io/settings#verifydepsbeforerun
    title: "verifyDepsBeforeRun: true, false, install, warn, error or prompt"
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T18:50:20Z
integrity:
  generated:
    body: 6cb1131478085c41
---

# After a workspace package is renamed, the next pnpm run installs before it runs the script

## What you see

You rename a workspace package (its directory, its `name`, or both) and run something that should only read the tree, such as `pnpm lint:md` or `pnpm build --filter <pkg>`. The lockfile and `node_modules` change anyway, and the output may begin with install progress.[^rename-observation]

## What you will wrongly conclude

That the script you ran wrote the lockfile, or that a plain `pnpm run` cannot mutate the tree. An agent that then inspects the diff may "repair" it, or attribute a resolution change to the wrong step.

## What is true

pnpm checks the workspace against the lockfile before it runs a script (`verifyDepsBeforeRun`). This repository sets no value for it, and on pnpm 12 the check found the renamed importer out of sync and ran an install before the script.[^pnpm-setting] The install is a real one: it re-resolves and rewrites the lockfile and `node_modules`.

So after a rename, run `pnpm install` yourself, on purpose, and review the lockfile diff before running anything else. Check in particular that platform binaries survived: [a plain install can strip them](plain-install-strips-platform-binaries.md). Treat any later `pnpm run` that rewrites the lockfile as a sign the tree had drifted again.

[^rename-observation]: Observed on branch feat/effect-4.1.1, 2026-10-31, pnpm 12.16.1.
[^pnpm-setting]: <https://pnpm.io/settings#verifydepsbeforerun>
