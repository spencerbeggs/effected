---
type: Decision
title: The kit builds itself with the bundler running from source under tsx
description: "The root pnpm-workspace.yaml sets nodeOptions to --import=tsx, and tsx and @effected/plugin are root devDependencies, so the effected bin runs from source in every pnpm run and turbo task; nothing is built before the bundler can build, and a bundler fix reaches the kit's build with no release in between."
status: draft
tags:
  - architecture
  - dx
  - deps
sources:
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
  - id: plan
    resource: ../../docs/superpowers/plans/2026-11-06-bundler-branch.md
    title: "Decisions this plan takes, item 2"
  - id: issue-1147
    resource: https://github.com/spencerbeggs/effected/issues/1147
    title: "bundler: @effected/bundler and the top-level @effected/plugin package"
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T20:18:23Z
integrity:
  generated:
    body: 39435bbfd0187421
---

# The kit builds itself with the bundler running from source under tsx

## Context

The kit built with `@savvy-web/bundler`, which depended on published copies of the kit, so an Effect minor advance had to pass through a kit release, two builder releases and a tsdoctor release before the kit could build on it, and every bundler fix was two releases from the kit's own build.[^spec] Moving the bundler into the repository ended that only if the kit did not then need a built bundler to build the bundler. The issue tracking the work assumed the previously published bundler would fill that role.[^issue-1147] The owner ruled that the kit builds with the bundler from source.[^spec]

## Decision

- **The root `pnpm-workspace.yaml` sets `nodeOptions: --import=tsx`,** because pnpm 12 ignores `node-options` in `.npmrc`, and `tsx` is a root devDependency, so every `pnpm run` and turbo task can execute TypeScript across the workspace.[^plan]
- **`@effected/plugin` is a root devDependency,** so `effected`, through its `src/bin/effected.ts` bin, runs from source in those same tasks. Each `@effected/*` import resolves through a [root workspace link](one-build-target-from-source-links.md) to that package's source.
- **Published bins are rewritten to `dist` by the manifest transform,** as they are today. A consumer never runs source or needs `tsx`.

**The source bins have two launch paths in this checkout.**

- **A pnpm script or turbo task:** `nodeOptions` loads tsx before the bin starts.
- **A direct run,** such as `node_modules/.bin/effected` or the plugin's `start-mcp.sh`: no `nodeOptions` applies, so the four source bins register tsx themselves when `import.meta.url` ends in `.ts`, and import everything else dynamically after that. The branch is dead in a built `.js` bin. tsx stays the workspace root's devDependency and no package declares it. Its specifier is computed, because rolldown folds a literal or a `const` and inlines tsx into the published package while `issues.json` stays clean. `packages/plugin/__test__/bin-launch.test.ts` pins both halves.

**`nodeOptions` does not reach every child safely.** `--import=tsx` resolves from each process's cwd, and children inherit it, so a child that a pnpm script starts in a directory that cannot resolve tsx dies at startup. The root vitest config clears `NODE_OPTIONS` for tests, and a test that runs sibling source in a child loads tsx itself. Nothing shields a repo script that spawns a tool in a temp directory.

The cost is the usual one for a self-hosting toolchain: a broken kit package can break the build of the kit. `savvy-web/systems` already lives with that. The published bundler is validated by the packed-install e2e, a real consumer install, which is where consumer behaviour should be proven.

## Alternatives rejected

- **Building with the previously published bundler.** It keeps the published-version lag this work exists to remove: a bundler fix would still need a release before the kit could use it.
- **A vendored private builder.** A second copy of the pipeline to keep in step with the first, with the same lag on every sync.
- **`linkWorkspacePackages: deep`.** It addresses resolving a published tool's kit dependencies to the workspace. A bundler running from source has none to redirect, so it would add a repo-wide resolution setting for nothing.
- **Raw Node with a `source` condition.** The probe made a two-package fixture work, but the kit's source imports its own files as `./x.js`, which Node's type stripping does not rewrite. `tsx` does. See [the single build target](one-build-target-from-source-links.md).

## Related

- [`@effected/bundler`](../modules/bundler.md) and [`@effected/plugin`](../modules/plugin.md) are the packages this runs.
- [One tool beside the libraries](one-tool-beside-the-libraries.md) records why the tool lives here at all.
- [The workspace module](../modules/workspace.md) documents root tooling.

[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 1, 5 and 12.
[^plan]: `docs/superpowers/plans/2026-11-06-bundler-branch.md`, the section "Decisions this plan takes".
[^issue-1147]: Issue 1147, `bundler: @effected/bundler and the top-level @effected/plugin package`.
