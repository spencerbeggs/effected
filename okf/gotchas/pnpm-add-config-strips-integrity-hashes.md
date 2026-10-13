---
type: Gotcha
title: pnpm add --config silently strips integrity hashes from every config dependency
description: Adding one new config dependency with pnpm add --config can remove the +sha512 integrity suffix from every existing configDependencies entry, not just the one being added.
status: stable
resource: ../../pnpm-workspace.yaml
stale_after: "2027-01-13T00:00:00Z"
tags:
  - security
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e7114462b4f12402
---

# `pnpm add --config` silently strips integrity hashes from every config dependency

## What a reader sees

A maintainer runs `pnpm add --config <some-new-package>` to add a new
pnpm config dependency alongside the existing ones (such as
`@effected/pnpm-plugin-effect` or `@savvy-web/pnpm-plugin-silk`). The
command succeeds, the new entry appears in `configDependencies`, and
nothing in the command's own output signals a problem with anything
else.

## What they will wrongly conclude

That only the newly-added entry changed, and that every other
`configDependencies` entry — including the ones that were already
integrity-pinned before this command ran — is untouched.

## What is actually true

Reproduced on pnpm 11.24.0: the new entry is written with **no**
`+sha512-…` integrity suffix, and every **other** `configDependencies`
entry in `pnpm-workspace.yaml` loses its suffix too, in the same write. A
subsequent plain `pnpm install` does not restore the stripped suffixes.
Config dependencies install ahead of the rest of the dependency tree and
can run install hooks, so this silently removes the integrity guard on
exactly the packages with the most reach into the install process — and
the damage is invisible unless someone diffs `pnpm-workspace.yaml` after
running the command, since nothing else in the workspace changes shape.
This was found by a consumer following this package's own documented
install step, in a cross-repository dogfood loop.

## The check

After running `pnpm add --config` for any reason, diff
`pnpm-workspace.yaml`'s `configDependencies` block in full, not just the
entry you intended to add — check every existing entry, not only the new
one, for a missing `+sha512-…` suffix. A hand-written hash is accepted
and preserved by pnpm once restored, so the fix is to look up the correct
integrity value for each stripped entry and re-add it by hand rather than
relying on any subsequent `pnpm install` to repair it. This repository's
own `@savvy-web/pnpm-plugin-silk` entry carries its hash deliberately for
this reason; check it specifically after any `--config` add.
