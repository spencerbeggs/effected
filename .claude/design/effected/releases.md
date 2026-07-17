---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-16
last-synced: 2026-07-16
completeness: 85
related:
  - architecture.md
  - package-inventory.md
  - effect-standards.md
  - roadmap.md
  - packages/toml.md
  - packages/store.md
  - packages/lockfiles.md
  - packages/xdg.md
  - packages/workspaces.md
  - packages/runtimes.md
  - packages/app.md
  - packages/tsconfig-json.md
  - packages/git.md
---

# Release criteria

## Overview

The kit is not released package-by-package. Every package publishes together at `0.1.0`, pinned against one `effect` beta, and `1.0.0` waits for Effect v4 GA. `0.1.0` ships as an explicit **pre-release**: nothing here claims stability, and consumer ports proceed against real published packages as post-`0.1.0` dogfooding rather than being gated behind a synthetic proof.

## Versioning

Version and stability are separate axes.

- **Version.** Every package stays below `1.0.0` until Effect `4.0.0` GA, pinning a single Effect v4 beta throughout development. Graduation to `1.0.0` follows Effect `4.0.0`. Until then the `effect` peer range names the beta pinned in the `effect` catalog in `pnpm-workspace.yaml`, and a beta bump is a coordinated change across the whole kit.
- **Stability.** A per-package `stable | unstable` axis independent of the version number. **All packages are `unstable` for `0.1.0`.** Consumers pin exact versions, so an accidental break surfaces in their type-checking rather than silently through a range — the pre-release contract made mechanical, and the safety valve that lets `0.1.0` publish before the consumer ports run.

`@effected/pnpm-plugin-effect` publishes with the kit, not apart from it. It is the kit's [companion](effect-standards.md#companion-packages-published-but-not-a-library) — published and installable but not a library, exposing no API and carrying no tier. Its reason to exist is consumer-facing: it carries the two Effect catalogs this repo pins against, so a consumer can hold their own `effect` versions and peer floors at the values the kit was built and tested against. **Installing it is optional for the consumer; shipping it is not optional for the release.** Do not read `"private": true` in a source manifest as evidence about release intent — every source manifest here is private, and the bundler's `publishConfig` transform emits the publishable manifest at build time ([architecture.md](architecture.md)).

## The five applications

The release criterion is "the kit can replace the business logic of these five." They split into two kinds.

**Migration targets** — absorbed into this repo:

- `type-registry-effect` — ported to `@effected/ts-vfs`, then **removed from the kit** and returned to the external `type-registry-effect` repo. It belongs to the `rspress-plugin-api-extractor` docs stack: it is the one package carrying the `typescript@^6` / `@typescript/vfs` peers, so keeping it out preserves the kit's "no `@effected/*` package imports `typescript`" posture. Its consumer consumes it from source.
- `runtime-resolver` — the library ships as `@effected/runtimes` (boundary tier). The CLI lives in the external `runtime-resolver` repo and re-ships from there against the published `@effected/runtimes`, so the library's consumers never install `@effect/platform-node`. See [packages/runtimes.md](packages/runtimes.md).

**External consumers** — stay in their own repos, per the libraries-only scope in [architecture.md](architecture.md). Each must be able to swap its `*-effect` dependencies for `@effected/*`:

- `rspress-plugin-api-extractor` — the published package is `plugin/`, not the repo root. It consumes `semver` and `store` from the kit, and `ts-vfs` from its own source repo.
- `vitest-agent` — consumes `workspaces`, `config-file`, `xdg` and `store`, and transitively `walker` and `lockfiles`.
- `soda3js/tools` — via `@soda3js/config`, an Effect package that loads and writes a TOML config file. It consumes `config-file` and `toml`, needing **only** TOML. `TomlCodec` arrives inside `@effected/config-file`, so this consumer carries unexecuted dependency edges on `@effected/jsonc` and `@effected/yaml`. It provably pays nothing for them — an explicitly-composed codec is tree-shaken when unreferenced and, unbundled, ESM never loads a module nobody imports ([packages/config-file.md](packages/config-file.md#the-load-bearing-constraint-free-standing-named-exports-never-a-namespace-object)). This is the consumer that would pay if either fact were ever falsified.
- `silk-update-action` (savvy-web) — consumes `workspaces` (root discovery, package-manager detection, the lockfile reader) and `lockfiles` (per-importer declared dependencies for before/after lockfile diffing).
- `savvy-web/systems` — via `@savvy-web/silk-effects`' DepsRegen engine: consumes `workspaces`' snapshot service (git at-ref and worktree snapshots), the opt-in config-dependency hook replay, and `@effected/git` directly for the git operations its tooling currently hand-rolls — DepsRegen's merge-base/ls-tree reads, the cli/mcp/silk-effects introspection wave and the repos domain's submodule mutations ([issue #82](https://github.com/spencerbeggs/effected/issues/82)).

## The gate

The gate is the union of what those consumers need, and it is met. The kit ships **eighteen publishable packages**: seventeen libraries plus the `pnpm-plugin-effect` companion.

| Package | Tier | Why it is on the gate |
| --- | --- | --- |
| `@effected/semver` | pure | `rspress-plugin-api-extractor`; the DX exemplar |
| `@effected/jsonc` | pure | `config-file`'s JSONC codec; parse/edit/format |
| `@effected/yaml` | pure | `config-file`'s YAML codec |
| `@effected/package-json` | integrated | manifest schemas and file IO for `workspaces` |
| `@effected/npm` | pure | dependency-resolution contracts `workspaces` implements |
| `@effected/config-file` | boundary | `vitest-agent` and `@soda3js/config`; carries the four codecs (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`) |
| `@effected/walker` | boundary | `config-file`, `xdg` and `workspaces` all traverse paths |
| `@effected/glob` | pure | `workspaces` uses it instead of a `minimatch` runtime dep |
| `@effected/toml` | pure | `@soda3js/config`; a full-parity format package |
| `@effected/lockfiles` | pure | `workspaces` and `silk-update-action` read lockfiles |
| `@effected/store` | integrated | SQLite cache + migrated state; `rspress-plugin-api-extractor` and `vitest-agent` both consume it |
| `@effected/xdg` | boundary | `vitest-agent`; zero runtime deps, does not depend on `store` |
| `@effected/workspaces` | integrated | `vitest-agent`, `silk-update-action`, `savvy-web/systems`; implements `@effected/npm`'s resolver contracts |
| `@effected/runtimes` | boundary | a migration target; takes only `@effected/semver` and core `HttpClient` |
| `@effected/tsconfig-json` | boundary | `rspress-plugin-api-extractor`'s tsconfig path and the `@savvy-web/bundler` port; owns the version-coupled enum mappings as data |
| `@effected/git` | boundary | typed git introspection plus a marked mutating tier over core's `ChildProcessSpawner`; consumers are `workspaces` and `savvy-web/systems` |
| `@effected/app` | integrated | the composition layer over `xdg` + `config-file` + `store`; nothing may depend on it |
| `@effected/pnpm-plugin-effect` | companion — no tier | not a library, but on the gate: it hands consumers the `effect` catalogs the kit was built against |

### `@effected/toml` is a full-parity format package

`@effected/toml` is a full-parity sibling to `@effected/jsonc` and `@effected/yaml` — parse, stringify, Schema, lossless CST, edit-in-place, formatter, visitor — on a from-scratch Effect-native engine targeting TOML 1.0.0, with `smol-toml` appearing only as a devDependency test oracle. The gate consumer `@soda3js/config` needs only parse/stringify: the consumer contract defines the minimum the package must satisfy, not its bound. [packages/toml.md](packages/toml.md) is authoritative.

### Not on the gate

- `@effected/json-schema` — off the roadmap entirely. Its core value is superseded by v4's `Schema.toJsonSchemaDocument`, and `xdg`'s dependency on it was a dead facade that was cut.
