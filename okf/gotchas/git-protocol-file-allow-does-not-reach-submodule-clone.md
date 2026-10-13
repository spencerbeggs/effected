---
type: Gotcha
title: A repo-local protocol.file.allow does not reach a submodule add's internal clone
description: "git 2.38+ refuses a file:// submodule remote by default; setting protocol.file.allow in the superproject's config looks like the fix but the internal clone subprocess never sees it, so only a command-line -c, the environment, or global config authorizes it."
status: stable
stale_after: "2027-03-20T00:00:00Z"
tags:
  - testing
  - security
sources:
  - id: git-surface-int-test
    resource: ../../packages/git/__test__/integration/GitSurface.int.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: 64844684013111be
---

# A repo-local protocol.file.allow does not reach a submodule add's internal clone

## What a reader sees

A test or fixture that adds a `file://` submodule fails with git's
transport refusal even though the superproject has `git config
protocol.file.allow always` set.

## What they would wrongly conclude

That the config key is misspelled, that `Git.submoduleAdd` strips the
setting, or that the package should pass an allow flag in its argv.

## What is actually true

git 2.38 and later (CVE-2022-39253) blocks `file://` submodule remotes by
default. A repo-local `protocol.file.allow` on the superproject does
**not** reach `git submodule add`'s internal clone subprocess (verified
against git 2.54); only a command-line `-c`, the environment
(`GIT_ALLOW_PROTOCOL=file`), or global config does. Whether to allow the
file transport is a caller-environment decision, not something `Git`'s
argv enables — nothing `@effected/git` spawns sets it, and it must not,
because the refusal is a security default.[^git-surface-int-test]

## The check

`GitSurface.int.test.ts` sets `process.env.GIT_ALLOW_PROTOCOL = "file"`
at module scope; `Git`'s per-call pins merge over `extendEnv: true`, so
the variable reaches every spawn in that file. The `forks` pool's
per-file process isolation keeps it from leaking into other suites. Copy
that shape for any fixture that needs a local submodule remote; do not
add a config write to the superproject expecting it to work.

[^git-surface-int-test]: `packages/git/__test__/integration/GitSurface.int.test.ts`
    — the module-scope `GIT_ALLOW_PROTOCOL` assignment and the comment
    recording the probe.
