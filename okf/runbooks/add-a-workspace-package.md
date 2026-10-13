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
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 53a9038465693d4d
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
   `homepage`, `repository.directory` and both model paths (`turbo.json`
   `outputs` and `savvy.build.ts` `localPaths`) to `X`.

   **Do not stop halfway with a manifest and no entrypoint.** Once
   `packages/X/package.json` exists, the `packages/*` glob in
   `pnpm-workspace.yaml` makes it a workspace member immediately — before
   `src/index.ts` exists. Any `pnpm run <script>` anywhere in the repo
   triggers pnpm's verify-deps check, which runs a full install, which
   runs every workspace package's `prepare` script (`turbo run
   build:dev`), and the new package's build fails because the entrypoint
   it resolves does not exist yet. Every script invocation repo-wide
   fails until the stub exists, and the failure surfaces far from its
   cause — running tests in an unrelated package reports a build failure
   in the package being scaffolded. This is unconditional: it holds even
   for a pure leaf package with no `workspace:*` edges at all, because
   every library manifest carries `prepare: turbo run build:dev` (the
   `pnpm-plugin-effect` companion is the lone exception, and nobody
   scaffolds a library from it), so any sibling-copied scaffold inherits
   the script regardless of what the new package depends on.

2. Run `pnpm install`, then check `git diff pnpm-lock.yaml`. A plain
   install has once stripped optional platform binaries (turbo, biome)
   from the lockfile; confirm the diff is only the new importer, not mass
   `optional: true` deletions.
3. Write the real modules.
4. Verify: `pnpm --filter @effected/X run types:check`; `pnpm build --filter @effected/X` with a zero-warning `dist/prod/issues.json` (never `node savvy.build.ts --target prod` directly — it skips `build:dev` and emits a truncated `issues.json` that looks clean); Biome and tests green.

## End state

`packages/X` builds cleanly through `pnpm build --filter @effected/X`,
typechecks, passes its tests, and no other package's `pnpm run` was ever
broken by its presence on disk. Adding it to the `effected` catalog
literal and the package table in [the Project concept](../project.md) is
the next step, covered by [add a kit package](add-a-kit-package.md).
