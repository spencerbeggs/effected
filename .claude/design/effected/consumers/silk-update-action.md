---
status: current
module: effected
category: feedback
created: 2026-07-25
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 88
related:
  - README.md
  - ../packages/github.md
  - ../packages/github-actions.md
  - ../packages/npm.md
  - ../packages/commands.md
  - ../packages/workspaces.md
  - ../packages/runtimes.md
  - ../github-action-canon.md
---

# silk-update-action

## Overview

`/Users/spencer/workspaces/savvy-web/silk-update-action` keeps a repository's dependencies current: it resolves registry versions, rewrites catalogs and manifests, upgrades the package manager and the runtime, runs the install, emits changesets, and opens the update PR.

It reaches `workspaces`, `npm`, `runtimes`, `lockfiles`, `semver`, `yaml`, `commands`, `git`, `github` and `github-actions` — the widest use of the kit's **monorepo** half, as distinct from silk-release-action's supply-chain half. It is one of the three actions the [action canon](../github-action-canon.md) was derived from.

## What it exercises

**The registry axis.** `NpmRegistry` is keyed registry → package → version here, and it is this repo that proved the axis: its release-age gate asks about publish times for specific versions from specific registries, which a package-keyed model could not answer. `src/services/release-age.ts` now composes `NpmRegistry` and `ReleaseAgeGate` from `@effected/npm` over `WorkspaceCatalogs.releaseAgeGate()` from `@effected/workspaces` — discovery on one side of the seam, registry facts on the other.

**Catalog and lockfile reality.** pnpm catalogs, `configDependencies`, workspace discovery, the dependency graph and lockfile reading, all against a real monorepo rather than a fixture. It is the kit's most demanding `@effected/workspaces` consumer after savvy-web/systems.

**Runtime resolution as a manifest concern.** `@effected/runtimes` resolves which Node, Bun or Deno version satisfies a range; this repo is what makes that useful, because it then writes the answer into `devEngines.runtime`.

## Where the kit's edge sits

- **The update policy itself** — which dependency sections to touch, the peer-sync rules, the three-way catalog merge, and the changeset a run emits.
- **`@savvy-web/silk-effects` `Changesets`** — the engine is policy and stays downstream.
- **`src/utils/runtime.ts`** — reading and rewriting `devEngines.runtime`. Deliberately pure and manifest-shaped: `@effected/runtimes` resolves versions and has no opinion about where they are written.
- **`src/utils/catalogs.ts`, `src/utils/pnpm.ts`, `src/utils/deps.ts`** — pure catalog-map, pnpm-version and `configDependencies` helpers over the manifest's own shape.
- **The fetch-a-config-dependency-tarball-and-import-it flow** (`src/services/module-catalogs.ts`, `src/services/catalog-config-deps.ts`).

## Open questions

1. **Catalog-field semantics are expressed twice.** `src/utils/catalogs.ts` coerces pnpm's `catalog`/`catalogs` fields into a plain record while `@effected/workspaces` ships `WorkspaceCatalogs` / `CatalogSet` over the same fields. The two serve different needs — one is a pure manifest-shaped helper, the other a discovered view — but whether that distinction is worth two implementations has never been decided.
2. **The tarball fetch-extract-import pattern appears twice here**, and is the second call site wanting an archive package that has not been built. See [silk-release-action](silk-release-action.md#open-questions), which holds the first.
