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
generated:
  by: "okfit/claude-code"
  at: 2026-11-09T00:05:23Z
integrity:
  generated:
    body: 261ede98fab8c06f
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
- `tsconfig.json` — `{ "$schema": "https://json.schemastore.org/tsconfig.json", "extends": "@effected/plugin/tsconfig/ecma.json" }`, identical across every package.
- `tsdoc.json` — copied verbatim from a sibling; the standard `supportForTags` allow-list, identical across packages.
- `effected.toml` — only when a package has something to say. Most have nothing: the bundler's defaults include the narrow `_base` suppression, and only six packages carry a file.
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
- `scripts`: `build` = `effected package build`, `types:check` = `tsc --noEmit`.[^semver-package-json]
- `devDependencies`: `@effect/vitest` and `effect` at `catalog:effected`; `@types/node` and `typescript` at `catalog:effected:build`. Do not add `@effect/tsgo` — see [the typechecker: tsc, not tsgo](../decisions/tsc-not-tsgo.md).
- `peerDependencies`: `effect` at `catalog:effected:peers` — the peer declaration draws from the `effected:peers` catalog, whose floored range is distinct from the `catalog:effected` install range the `devDependencies` entry uses.
- Sibling `@effected/*` edges use `workspace:^`, whether dependencies or peers. The one exception is a `devDependency` that satisfies an auto-installed peer, which stays `workspace:*` because it is never published.
- `engines`: `node >=24.11.0`, matching every sibling and the root manifest.
- `publishConfig`: `{ access: "public", targets: { npm: true } }`.

## Cross-package build dependencies

There are none. A workspace `@effected/*` dependency links at the package root, and its `exports` name `./src/index.ts`, so a consumer imports the sibling's source with no build first. See [one build target](../decisions/one-build-target-from-source-links.md).

## Workspace wiring

Wiring is mostly automatic once the files exist:

- The `packages/*` glob in `pnpm-workspace.yaml` picks up the new package — no manual registration.
- `catalog:effected`, `catalog:effected:peers`, `catalog:effected:build` and `catalog:effected:build:peers` live in `pnpm-workspace.yaml`; the build pair supplies `@types/node` and `typescript`.
- **The `effected` catalog is not automatic.** A new publishable package must be added to the `effected` catalog literal in `packages/pnpm-plugin-effected/lib/build/pnpm-config.plugin.ts` and to that package's `turbo.json` `build` `inputs` list. The plugin's catalog test asserts the catalog covers every package whose manifest has `publishConfig.access === "public"`, so skipping this turns a scaffold into a failing test suite.

[^semver-package-json]: `packages/semver/package.json` — a complete pure-tier
    manifest matching every field described above.
