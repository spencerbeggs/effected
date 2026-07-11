---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-07-11
last-synced: 2026-07-11
completeness: 85
related:
  - architecture.md
  - package-inventory.md
  - effect-standards.md
  - packages/toml.md
  - packages/store.md
  - packages/lockfiles.md
  - packages/xdg.md
  - packages/workspaces.md
  - packages/runtime-resolver.md
---

# Release criteria

## Overview

The kit is not released package-by-package. Nothing goes to npm until the whole kit can replace the business logic of five named applications; at that point every package publishes together at `0.1.0`, pinned against one `effect` beta. `1.0.0` waits for Effect v4 GA.

This is a deliberate trade. Publishing early would get the consumer applications onto real packages sooner and surface integration problems as they arise. Holding instead buys one internally-consistent graph on day one: every package's peer range names the same `effect` beta, no consumer ever installs a half-built kit, and no version is burned while the beta line is still moving. The cost is that integration problems arrive late and all at once, which the migration playbook's per-package gates are meant to absorb.

## The five applications

The criterion is "the kit can replace the business logic of these five." They split into two kinds, and the distinction decides what work the criterion actually names.

**Migration targets** — absorbed into this repo, so "replacing their business logic" means porting them:

- `type-registry-effect` → `@effected/type-registry`. **Not started; the next migration.**
- `runtime-resolver` → `@effected/runtime-resolver` + `@effected/runtime-resolver-cli`. **Merged**: the v3 repo's library and CLI both live here now, as two packages so that the binary's `@effect/platform-node` dependency does not reach the library's consumers.

**External consumers** — stay in their own repos, per the libraries-only scope in [architecture.md](architecture.md). Each must be able to swap its `*-effect` dependencies for `@effected/*`:

- `rspress-plugin-api-extractor` — the published package is `plugin/`, not the repo root. It carries 24 runtime dependencies including `type-registry-effect`, `semver-effect`, `@effect/sql` and `@effect/sql-sqlite-node`. It consumes `semver`, `type-registry` and `store`.
- `vitest-agent` — an 11-package monorepo depending on `workspaces-effect`, `config-file-effect` and `xdg-effect`. It consumes `workspaces`, `config-file`, `xdg` and `store`, and transitively `walker` and `lockfiles`.
- `soda3js/tools` — specifically `@soda3js/config` (`dependencies: effect, smol-toml`), an Effect package whose job is loading and writing a TOML config file. It consumes `config-file`, `config-file-toml` and `toml`.

`@effected/type-registry` is load-bearing for two of the five — it is a migration target in its own right and `rspress-plugin-api-extractor` depends on it — which is why it never sequenced at the end. With everything else merged it is now simply **next**, and the only package left behind it is `app-kit`, which no consumer is blocked on because nothing may depend on it (a library taking an application control plane would be an R2 tier-3 leak).

## The gate

The union of what those consumers need. **Eighteen packages are already merged** (`semver`, `jsonc`, `yaml`, `package-json`, `npm`, `config-file`, `config-file-jsonc`, `config-file-yaml`, `config-file-toml`, `walker`, `glob`, `toml`, `lockfiles`, `store`, `xdg`, `runtime-resolver`, `runtime-resolver-cli`, `workspaces` — `pnpm-plugin-effect` is infrastructure and outside this count); **two remain**, `type-registry` then `app-kit`, per the [migration order](package-inventory.md#migration-order):

| Package | Tier | Status | Why it is on the gate |
| --- | --- | --- | --- |
| `@effected/walker` | boundary | merged | `config-file`, `xdg` and `workspaces` all traverse paths |
| `@effected/glob` | pure | merged | `workspaces` drops its `minimatch` runtime dep for it |
| `@effected/lockfiles` | pure | merged | `workspaces` reads lockfiles |
| `@effected/store` | integrated | merged | SQLite cache + migrated state (`@effect/sql-sqlite-node`); `rspress-plugin-api-extractor` and `vitest-agent` both consume it |
| `@effected/xdg` | boundary | merged | `vitest-agent`, `type-registry`; zero runtime deps, and it does not depend on `store` |
| `@effected/workspaces` | integrated | merged | `vitest-agent`; takes `@pnpm/catalogs.*`, and implements `@effected/npm`'s resolver contracts |
| `@effected/runtime-resolver` | boundary | merged | a migration target; takes only `@effected/semver` and core `HttpClient` |
| `@effected/runtime-resolver-cli` | integrated | merged | the binary, split out so the library's consumers do not pay for `@effect/platform-node` |
| `@effected/toml` | pure | merged | `@soda3js/config` |
| `@effected/config-file-toml` | pure | merged | `@soda3js/config` |
| `@effected/type-registry` | integrated | **not started — next** | `rspress-plugin-api-extractor`, and a migration target |
| `@effected/app-kit` | integrated | **not started — last** | the composition layer over `xdg` + `config-file` + `store` (integrated via R2 over `store`) |

### `@effected/toml` is a full-parity format package

**Re-specced 2026-07-10, superseding the 2026-07-09 rescope this section previously recorded** (parse/stringify-only over a vendored smol-toml port). `@effected/toml` is a full-parity sibling to `@effected/jsonc` and `@effected/yaml` — parse, stringify, Schema, lossless CST, edit-in-place, formatter, visitor — on a **from-scratch Effect-native engine** targeting TOML 1.0.0, with `smol-toml` appearing only as a devDependency test oracle. The gate consumer `@soda3js/config` still needs only parse/stringify: the consumer contract defines the minimum the package must satisfy, no longer its bound — the same reversal glob made of this section's original scoping precedent. [packages/toml.md](packages/toml.md) is authoritative.

### Not on the gate

- `@effected/json-schema` — its core value was superseded by v4's `Schema.toJsonSchemaDocument`, and `xdg`'s dependency on it was a dead facade. The xdg migration **cut it**, as predicted: nothing in the v3 `src/` used it, and it existed only to power a re-export facade the [no-barrel rule](effect-standards.md#no-barrel-re-exports) forbids anyway. The package is off the roadmap with no loose ends.

## Versioning

Every package stays below `1.0.0` until Effect v4 officially releases. Until then the `effect` peer range names the beta pinned in the `effect` catalog in `pnpm-workspace.yaml`, and a beta bump is a coordinated change across the whole kit rather than a per-package decision.

## Markdown

`rspress-plugin-api-extractor` already parses and emits markdown, via `mdast-util-from-markdown`, `mdast-util-to-hast` and `gray-matter`. A future `@effected/markdown` therefore has a real, identified consumer rather than a speculative one — reading and writing markdown at a low level is what AI-facing tooling does. It is still not a release gate: the plugin can keep its `mdast` dependencies and swap everything else. Sequenced after `0.1.0`.
