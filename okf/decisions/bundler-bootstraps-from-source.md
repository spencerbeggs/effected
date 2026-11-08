---
type: Decision
title: The kit builds itself with the bundler running from source under tsx
description: "The root pnpm-workspace.yaml sets nodeOptions to --import=tsx, and tsx and @effected/plugin are root devDependencies, so the effected bin runs from source in every pnpm run and turbo task; nothing is built before the bundler can build, and a bundler fix reaches the kit's build with no release in between."
status: stable
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
  at: 2026-11-07T00:15:31Z
integrity:
  generated:
    body: 8ace4ddfcd717364
  verified:
    by: human:spencer
    at: 2026-11-08T18:25:54Z
    content: 80b92feec283b687
verified:
  - by: human:spencer
    at: 2026-11-08T18:25:54Z
---

# The kit builds itself with the bundler running from source under tsx

## Context

The kit built with `@savvy-web/bundler`, which depended on published copies of the kit, so an Effect minor advance had to pass through a kit release, two builder releases and a tsdoctor release before the kit could build on it, and every bundler fix was two releases from the kit's own build.[^spec] Moving the bundler into the repository ended that only if the kit did not then need a built bundler to build the bundler. The issue tracking the work assumed the previously published bundler would fill that role.[^issue-1147] The owner ruled that the kit builds with the bundler from source.[^spec]

## Decision

- **The root `pnpm-workspace.yaml` sets `nodeOptions: --import=tsx`,** because pnpm 12 ignores `node-options` in `.npmrc`, and `tsx` is a root devDependency, so every `pnpm run` and turbo task can execute TypeScript across the workspace.[^plan]
- **`@effected/plugin` is a root devDependency,** so `effected`, through its `src/bin/effected.ts` bin, runs from source in those same tasks. Each `@effected/*` import resolves through a [root workspace link](one-build-target-from-source-links.md) to that package's source.
- **Published bins are rewritten to `dist` by the manifest transform.** A consumer never runs source or needs `tsx`.

**The source bins have two launch paths in this checkout.**

- **A pnpm script or turbo task:** `nodeOptions` loads tsx before the bin starts.
- **A direct run,** such as `node_modules/.bin/effected` or the plugin's `start-mcp.sh`: no `nodeOptions` applies, so the four source bins register tsx themselves when `import.meta.url` ends in `.ts`, and import everything else dynamically after that. The branch is dead in a built `.js` bin. tsx stays the workspace root's devDependency and no package declares it. Its specifier is computed, because rolldown folds a literal or a `const` and inlines tsx into the published package while `issues.json` stays clean. `packages/plugin/__test__/bin-launch.test.ts` pins both halves.

**`nodeOptions` does not reach every child safely.** `--import=tsx` resolves from each process's cwd, and children inherit it, so a child that a pnpm script starts in a directory that cannot resolve tsx dies at startup. The root vitest config clears `NODE_OPTIONS` for tests, and a test that runs sibling source in a child loads tsx itself. Nothing shields a repo script that spawns a tool in a temp directory.

**A self-hosting consumer has the same contract.** A repository whose root depends on its own carrier through `workspace:*` runs that carrier's bins from source, so `node_modules/.bin/<tool>` has no `nodeOptions` under a hook, an MCP loader or a bare shell. The kit's answer works there unchanged: the bin file registers tsx itself when it runs from `.ts`, by the guarded dynamic import of `tsx/esm/api` above, and imports everything else dynamically after that, with `tsx` as a root devDependency. Then `.bin/<tool>` runs outside pnpm. The contract has three cases: a SOURCE bin self-registers tsx; a BUILT bin's self-registration branch is dead, and in a linked workspace that built bin still imports siblings from source, so a test that spawns a built bin in the workspace passes `--import <absolute file URL of tsx>` (as the kit's own `packages/cli/__test__/e2e/*.e2e.test.ts` do); an installed consumer needs nothing. Launching through `pnpm run` is not the contract.

**A self-hosting repository with `.tsx` sources puts `/** @jsxRuntime automatic */` at the top of every `.tsx` file.** tsx applies one tsconfig per process, found from the working directory, and only to files that tsconfig includes. From a root whose tsconfig does not include package sources, a linked package's JSX compiles to classic `React.createElement`, and a TTY run of a live view then fails with `React is not defined` while a captured run stays green. A probe of tsx's API settled the alternatives, each of which depends on the process or reaches one package:

| Setting, with a linked `.tsx` under test | Result |
| --- | --- |
| Bare `register()` or `--import=tsx`, from the root | classic |
| `jsx: react-jsx` added to a root tsconfig that does not include package sources | classic |
| `register({ tsconfig })` naming one package's tsconfig | automatic for that package, classic for every other |
| A root tsconfig with `jsx` and an `include` reaching package sources | automatic from the root, classic from inside any package with its own tsconfig |
| The pragma | automatic in every case |

`register()` does take a `tsconfig` option. The kit's bins deliberately call it bare, because a single tsconfig cannot serve every linked package, so the pragma is the working-directory-independent answer either way. **The kit is not exposed:** it tracks no `.tsx` under `packages/*/src`, and `cli-kit`'s views are plain `.ts`, so its own suite cannot catch this class. Built output is unaffected, since the declaration and JS passes read the package's own tsconfig.

**The `nodeOptions` recipe is repo-global, and a tool that loads its own bundles can break under it.** Every process a pnpm script starts inherits it. rspress is the known case: `rspress build` fails loading its SSG bundle under `--import=tsx` and passes without it. The escape is `NODE_OPTIONS=` at the front of that script. A root `build` script also uses `--filter=!docs` when a website package has its own `build` task, or every root build runs the site.

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
