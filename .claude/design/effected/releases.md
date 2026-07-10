---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-10
last-synced: 2026-07-10
completeness: 85
related:
  - architecture.md
  - package-inventory.md
  - effect-standards.md
  - packages/toml.md
---

# Release criteria

## Overview

The kit is not released package-by-package. Nothing goes to npm until the whole kit can replace the business logic of five named applications; at that point every package publishes together at `0.1.0`, pinned against one `effect` beta. `1.0.0` waits for Effect v4 GA.

This is a deliberate trade. Publishing early would get the consumer applications onto real packages sooner and surface integration problems as they arise. Holding instead buys one internally-consistent graph on day one: every package's peer range names the same `effect` beta, no consumer ever installs a half-built kit, and no version is burned while the beta line is still moving. The cost is that integration problems arrive late and all at once, which the migration playbook's per-package gates are meant to absorb.

## The five applications

The criterion is "the kit can replace the business logic of these five." They split into two kinds, and the distinction decides what work the criterion actually names.

**Migration targets** — absorbed into this repo, so "replacing their business logic" means porting them:

- `type-registry-effect` → `@effected/type-registry`
- `runtime-resolver` → `@effected/runtime-resolver`

**External consumers** — stay in their own repos, per the libraries-only scope in [architecture.md](architecture.md). Each must be able to swap its `*-effect` dependencies for `@effected/*`:

- `rspress-plugin-api-extractor` — the published package is `plugin/`, not the repo root. It carries 24 runtime dependencies including `type-registry-effect`, `semver-effect`, `@effect/sql` and `@effect/sql-sqlite-node`. It consumes `semver`, `type-registry` and `store`.
- `vitest-agent` — an 11-package monorepo depending on `workspaces-effect`, `config-file-effect` and `xdg-effect`. It consumes `workspaces`, `config-file`, `xdg` and `store`, and transitively `walker` and `lockfiles`.
- `soda3js/tools` — specifically `@soda3js/config` (`dependencies: effect, smol-toml`), an Effect package whose job is loading and writing a TOML config file. It consumes `config-file`, `config-file-toml` and `toml`.

`@effected/type-registry` is load-bearing for two of the five, so it sequences near the middle of the roadmap rather than at the end.

## The gate

The union of what those consumers need. Eleven packages are already merged (`semver`, `jsonc`, `yaml`, `package-json`, `npm`, `config-file`, `config-file-jsonc`, `config-file-yaml`, `walker`, `glob`, `toml` — `pnpm-plugin-effect` is infrastructure and outside this count); eight remain:

| Package | Tier | Status | Why it is on the gate |
| --- | --- | --- | --- |
| `@effected/walker` | boundary | merged | `config-file`, `xdg` and `workspaces` all traverse paths |
| `@effected/glob` | pure | merged | `workspaces` drops its `minimatch` runtime dep for it |
| `@effected/lockfiles` | pure | not started | `workspaces` reads lockfiles |
| `@effected/store` | integrated | not started | SQLite cache + migrated state (`@effect/sql-sqlite-node`); both remaining consumers use it |
| `@effected/xdg` | boundary | not started | `vitest-agent`, `type-registry` |
| `@effected/workspaces` | integrated | not started | `vitest-agent`; takes `@pnpm/catalogs.*` |
| `@effected/app-kit` | integrated | not started | the composition layer over `xdg` + `config-file` + `store` (integrated via R2 over `store`) |
| `@effected/type-registry` | integrated | not started | `rspress-plugin-api-extractor`, and a migration target |
| `@effected/runtime-resolver` | boundary | not started | a migration target; its `@effect/cli` binary splits into a separate integrated CLI package |
| `@effected/toml` | pure | merged | `@soda3js/config` |
| `@effected/config-file-toml` | pure | not started | `@soda3js/config` |

### `@effected/toml` is a full-parity format package

**Re-specced 2026-07-10, superseding the 2026-07-09 rescope this section previously recorded** (parse/stringify-only over a vendored smol-toml port). `@effected/toml` is a full-parity sibling to `@effected/jsonc` and `@effected/yaml` — parse, stringify, Schema, lossless CST, edit-in-place, formatter, visitor — on a **from-scratch Effect-native engine** targeting TOML 1.0.0, with `smol-toml` appearing only as a devDependency test oracle. The gate consumer `@soda3js/config` still needs only parse/stringify: the consumer contract defines the minimum the package must satisfy, no longer its bound — the same reversal glob made of this section's original scoping precedent. [packages/toml.md](packages/toml.md) is authoritative.

### Not on the gate

- `@effected/json-schema` — its core value was superseded by v4's `Schema.toJsonSchemaDocument`, and `xdg`'s dependency on it is a dead facade that gets cut at migration time.

## Versioning

Every package stays below `1.0.0` until Effect v4 officially releases. Until then the `effect` peer range names the beta pinned in the `effect` catalog in `pnpm-workspace.yaml`, and a beta bump is a coordinated change across the whole kit rather than a per-package decision.

## Markdown

`rspress-plugin-api-extractor` already parses and emits markdown, via `mdast-util-from-markdown`, `mdast-util-to-hast` and `gray-matter`. A future `@effected/markdown` therefore has a real, identified consumer rather than a speculative one — reading and writing markdown at a low level is what AI-facing tooling does. It is still not a release gate: the plugin can keep its `mdast` dependencies and swap everything else. Sequenced after `0.1.0`.
