---
type: Limitation
title: Git.configSet cannot write a value that begins with a dash
description: "configSet guards key, value and file through the option-injection guard because git config has no documented -- separator, so a legitimate value starting with - is refused typed before any spawn."
status: stable
bounds: ../modules/git.md
tags:
  - security
sources:
  - id: git-service
    resource: ../../packages/git/src/Git.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: fa67ebb7dcbac1d9
---

# Git.configSet cannot write a value that begins with a dash

## Condition

A caller passes `Git.configSet` a `key`, `value` or `options.file` whose
first character is `-`.

## Symptom

The call fails with a `GitCommandError` of `kind: "refused"` before
anything is spawned, reporting the value as `<redacted>`. A config value
that legitimately starts with a dash — a negative number, a flag-shaped
string — cannot be written through this method.[^git-service]

## Why this is acceptable

The option-injection guard exists so that no caller-controlled positional
can be parsed by git as a flag. For the ref-taking members the guard is
narrow because a `--` separator is deliberately not used (it would flip
`checkout` into pathspec mode), but `git config` has no documented `--`
separator at all, so there is no argv position at which a dash-leading
value is safe. Refusing all three string inputs is the only shape that
keeps the guarantee, and a dash-leading config value is rare enough that
closing the injection surface wins.

## What the fix would take

Writing such a value through `GitConfig`'s pure surgical editor on the
file's text and saving it, which involves no argv at all, or a future git
version documenting a separator for `config` that the guard could then
rely on.

[^git-service]: `packages/git/src/Git.ts` — `configSet` routes `key`,
    `value` and `options.file` through `rejectOptionLikeRefs`.
