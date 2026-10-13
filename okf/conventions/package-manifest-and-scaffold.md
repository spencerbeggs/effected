---
type: Convention
title: Every package carries the same manifest shape and file set
description: A pure-tier package mirrors a sibling's file manifest and package.json shape byte-for-byte except for the fields that are load-bearing per-package.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
  - dx
sources:
  - id: semver-package-json
    resource: ../../packages/semver/package.json
  - id: semver-turbo
    resource: ../../packages/semver/turbo.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5f5187a9e430b8d6
---

# Every package carries the same manifest shape and file set

Copy a sibling pure-tier package and rename it rather than building a new
package from scratch. `packages/semver`, `packages/jsonc` and
`packages/yaml` are the canonical siblings to copy: their manifests and
supporting files are byte-identical except for the fields this convention
calls out as per-package.[^semver-package-json]

## File manifest

A package `packages/X` (npm name `@effected/X`) carries these files:

- `package.json` — see [the package.json shape](#packagejson-shape).
- `tsconfig.json` — `{ "$schema": "https://json.schemastore.org/tsconfig.json", "extends": "@savvy-web/bundler/tsconfig/ecma.json" }`, identical across every package.
- `turbo.json` — `{ "extends": ["//"], "tasks": { "build:prod": { "outputs": ["$TURBO_EXTENDS$", "../../website/lib/models/X"] } } }`. The `outputs` model path must name the package's OWN directory — a copy-paste sibling name here is an easy mistake, and every model path is per-package.[^semver-turbo]
- `tsdoc.json` — copied verbatim from a sibling; the standard `supportForTags` allow-list, identical across packages.
- `savvy.build.ts` — `import { build } from "@savvy-web/bundler"; await build({ meta: { localPaths: ["../../website/lib/models/X"] } });`. The `localPaths` entry follows the same per-package rename rule as `turbo.json`.
- `LICENSE`, `CLAUDE.md`, `README.md` — copied or authored per-package; `CLAUDE.md` is where the package documents itself, and the root `CLAUDE.md` deliberately does not duplicate it.
- `src/index.ts` — the public entrypoint, re-exports only.
- `__test__/` — tests live here, never co-located in `src/`.

## package.json shape

Mirror a sibling's `package.json` and change only the package-specific
fields:

- `name` `@effected/X`, `version` `0.0.0` for a new package, `type` `module`, `sideEffects` `false` for pure libraries.
- `private: true` is deliberate: the bundler's `publishConfig`-driven transform produces the publishable manifest at build time. Never set `private: false` in source.
- `repository.directory` must be `packages/X` — easy to leave pointing at the copied sibling.
- `homepage` must be `https://github.com/spencerbeggs/effected/tree/main/packages/X#readme`. The `/tree/main/` segment is load-bearing: the shorter form without it 404s, because GitHub reads a bare `/packages/X` path as a repo route rather than a tree path.
- `exports`: `{ ".": "./src/index.ts", "./package.json": "./package.json" }` for a single-entrypoint package — see [a second published entrypoint](../decisions/second-published-entrypoint.md) for the two packages that add a subpath.
- `scripts`: `build:dev` = `node savvy.build.ts --target dev`, `build:prod` = `node savvy.build.ts --target prod`, `types:check` = `tsc --noEmit`.[^semver-package-json] A package with a workspace edge to another `@effected/*` package also needs `prepare` = `turbo run build:dev` — see [Cross-package build dependencies](#cross-package-build-dependencies).
- `devDependencies`: `@savvy-web/bundler` (a plain semver range, not catalogued, and always a `devDependency` — never a `dependency`, or the publishable manifest ships a build tool at runtime); `@effect/vitest` and `effect` at `catalog:effect`; `@types/node` and `typescript` at `catalog:build`. Do not add `@effect/tsgo` — see [the typechecker: tsc, not tsgo](../decisions/tsc-not-tsgo.md).
- `peerDependencies`: `effect` at `catalog:effect:peers` — the peer declaration draws from the `effect:peers` catalog, distinct from the `catalog:effect` the `devDependencies` entry uses.
- Sibling `@effected/*` edges use `workspace:^`, whether dependencies or peers. The one exception is a `devDependency` that satisfies an auto-installed peer, which stays `workspace:*` because it is never published.
- `engines`: `node >=24.11.0`, matching every sibling and the root manifest.
- `publishConfig`: `{ access: "public", directory: "dist/dev/pkg", linkDirectory: true, targets: { npm: true } }`.

## Cross-package build dependencies

`publishConfig.linkDirectory: true` with `directory: dist/dev/pkg` means
pnpm links a workspace `@effected/*` dependency into its consumer's
`node_modules` pointing at the dependency's `dist/dev/pkg`, not its
source (for example `node_modules/@effected/npm -> ../../../npm/dist/dev/pkg`).
So the dependency must be **built** before the consumer can import it:
importing an unbuilt sibling resolves to a dangling symlink. This does
not bite a pure leaf package with no sibling `@effected/*` dependency,
but it breaks a consumer's tests against a fresh checkout, where no
`dist/dev/pkg` exists yet.

The fix is the `prepare` pattern: any package with a workspace edge to
another `@effected/*` package adds `"prepare": "turbo run build:dev"` to
its `scripts`. pnpm runs a workspace package's `prepare` on install, and
`turbo run build:dev` scoped to that package builds it and its
dependencies in topological order via the `^build:dev` task edge, so
every `dist/dev/pkg` a consumer links to exists before tests run.
Strictly, only the consumer needs the script — a pure leaf's dependents
build it via their own `turbo run build:dev` — but every library package
carries it anyway (all but the `pnpm-plugin-effect` companion), leaves
included, because a scaffold copied from any sibling inherits the script
regardless of what the new package depends on.

## Workspace wiring

Wiring is mostly automatic once the files exist:

- The `packages/*` glob in `pnpm-workspace.yaml` picks up the new package — no manual registration.
- `catalog:effect` and `catalog:effect:peers` live in `pnpm-workspace.yaml`. `catalog:build`, which supplies `@types/node` and `typescript`, does not — it is injected by a config dependency, so its absence from `pnpm-workspace.yaml` is expected.
- **The `effected` catalog is not automatic.** A new publishable package must be added to the `effected` catalog literal in `packages/pnpm-plugin-effect/savvy.build.ts` and to that package's `turbo.json` build `inputs` lists (both `build:dev` and `build:prod`). The plugin's catalog test asserts the catalog covers every package whose manifest has `publishConfig.access === "public"`, so skipping this turns a scaffold into a failing test suite.
- The api-extractor model is wired by the `turbo.json` `outputs` entry plus the `savvy.build.ts` `localPaths` (both `../../website/lib/models/X`). The generated model under `website/lib/models/X` is a `build:prod` artifact, not committed.

[^semver-package-json]: `packages/semver/package.json` — a complete pure-tier
    manifest matching every field described above.
[^semver-turbo]: `packages/semver/turbo.json` — the per-package `outputs`
    model path pattern.
