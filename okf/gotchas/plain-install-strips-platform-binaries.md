---
type: Gotcha
title: A plain pnpm install can silently strip platform binaries from the lockfile
description: An ordinary pnpm install has previously removed turbo, biome, and tsgo's platform-specific optional-dependency entries from pnpm-lock.yaml with no error.
status: stable
resource: ../../pnpm-lock.yaml
stale_after: 2027-01-13T00:00:00Z
tags:
  - ci
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: a18301e55e3af27d
---

# A plain pnpm install can silently strip platform binaries from the lockfile

## What a reader sees

`pnpm install` completes with no errors and no warnings, exactly like every
other successful install in the repository's history.[^claude-md]

## What they wrongly conclude

That an install with a clean exit code and no diagnostic output changed
nothing worth checking, so the lockfile diff after routine dependency work
does not need review.

## What is actually true

A plain `pnpm install` has, at least once, stripped the platform-specific
optional-dependency entries for `turbo`, `biome`, and `tsgo` out of
`pnpm-lock.yaml` — packages whose correct binary depends on the resolving
machine's OS and architecture — with no error surfaced anywhere in the
install's output. The tools keep working locally on the machine that still
has the binary cached, which is exactly what makes the stripped lockfile
look harmless until a different machine or a fresh CI runner installs from
it and cannot find the platform package it needs.

## The check

Always inspect the lockfile diff after any `pnpm install`, dependency bump,
or catalog change — specifically looking for removed `optionalDependencies`
entries under `turbo`, `@biomejs/biome`, or `@typescript/native-preview`
(tsgo). A diff that only adds or bumps versions is expected; a diff that
drops a platform-scoped optional dependency with no corresponding version
change anywhere else is the signal to re-run the install and re-check
before committing.

[^claude-md]: `CLAUDE.md` — "Always check the lockfile diff after an
    install — a plain `pnpm install` can strip turbo/biome/tsgo platform
    binaries from it."
