---
type: Gotcha
title: npm run silently claims flags meant for the script
description: "`npm run <script> --flag` delivers nothing to the script itself — npm claims the flag for its own argument parsing — while pnpm, yarn and bun all forward post-script arguments without any extra syntax."
status: stable
resource: ../../packages/commands/src/LocalExec.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 7aba7384e283f656
---

# npm run silently claims flags meant for the script

## What a reader sees

Code that runs a package-manager script with an appended flag —
`npm run build --watch`, say — across multiple package managers, expecting
the flag to reach the script the same way in every case.

## What they would wrongly conclude

That the flag reaches the script consistently regardless of which package
manager ran it, since the invocation reads identically apart from the
manager name.

## What is actually true

npm's argument handling is the odd one out among the four major package
managers: bare `npm run <script> --flag` silently claims `--flag` for
npm's own argument parsing rather than forwarding it to the script, with
no error and no warning that the flag went missing. This was confirmed by
a live probe against npm 11: `npm run args --flag` delivers nothing extra
to the script, while `npm run -- args --flag` correctly delivers `--flag`
to it. pnpm, yarn and bun all forward post-script arguments to the
underlying script without needing any extra separator.

## The check

When building a script invocation that must work uniformly across package
managers, use each manager's own script prefix rather than a hand-written
one — npm's carries a mandatory trailing `--` (`["npm", "run", "--"]`)
specifically to defeat this behavior, while the other three do not need
it.[^local-exec] Never assume a flag appended after an `npm run <script>`
invocation reaches the script without verifying the `--` separator is
present.

[^local-exec]: `packages/commands/src/LocalExec.ts:41-56,191-196` — the
    prefix table's comment documents the live probe result, and
    `scriptPrefix` is a required `ExecContext` field specifically so no
    implementation can supply an "obvious" default that gets this wrong.
