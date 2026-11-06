---
type: Runbook
title: Add a workspace package
description: The ordered scaffold procedure for a new packages/X library, with the stub-entrypoint-before-install step that keeps a half-scaffolded package from breaking every pnpm run in the repo.
status: stable
tags:
  - dx
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T20:09:15Z
integrity:
  generated:
    body: 200972a3ea09886b
---

# Add a workspace package

## Trigger

A new `@effected/X` library is ready to be scaffolded, following
[the package manifest and scaffold convention](../conventions/package-manifest-and-scaffold.md).

## Steps

1. Create `packages/X/{src,__test__}` and every file the manifest
   convention lists, **including a stub `src/index.ts`** — an empty file
   or a single `export {}` is enough, since it only has to resolve. Copy
   `tsdoc.json` and `LICENSE` verbatim from a sibling; set `name`,
   `homepage` and `repository.directory` to `X`.

   **Do not stop halfway with a manifest and no entrypoint.** Once
   `packages/X/package.json` exists, the `packages/*` glob in
   `pnpm-workspace.yaml` makes it a workspace member immediately, and a
   `pnpm build` or a typecheck that reaches it fails until the stub exists.

2. Run `pnpm install`, then check `git diff pnpm-lock.yaml`. A plain
   install has once stripped optional platform binaries (turbo, biome)
   from the lockfile; confirm the diff is only the new importer, not mass
   `optional: true` deletions.
3. Write the real modules.
4. Verify: `pnpm --filter @effected/X run types:check`; `pnpm build --filter @effected/X` with a zero-warning `dist/prod/issues.json`; Biome and tests green.

## End state

`packages/X` builds cleanly through `pnpm build --filter @effected/X`,
typechecks, passes its tests, and no other package's `pnpm run` was ever
broken by its presence on disk. Adding it to the `effected` catalog
literal and the package table in [the Project concept](../project.md) is
the next step, covered by [add a kit package](add-a-kit-package.md).
