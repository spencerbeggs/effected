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

- `type-registry-effect` → **`@effected/ts-vfs`** (renamed from `@effected/type-registry` on 2026-07-11; see [the ts-vfs rename](package-inventory.md#the-ts-vfs-rename)). **Not started; the next migration.** The v3 source package keeps its own name — only the target renames.
- `runtime-resolver` → `@effected/runtime-resolver` + `@effected/runtime-resolver-cli`. **Merged**: the v3 repo's library and CLI both live here now, as two packages so that the binary's `@effect/platform-node` dependency does not reach the library's consumers.

**External consumers** — stay in their own repos, per the libraries-only scope in [architecture.md](architecture.md). Each must be able to swap its `*-effect` dependencies for `@effected/*`:

- `rspress-plugin-api-extractor` — the published package is `plugin/`, not the repo root. It carries 24 runtime dependencies including `type-registry-effect`, `semver-effect`, `@effect/sql` and `@effect/sql-sqlite-node`. It consumes `semver`, `ts-vfs` and `store`.
- `vitest-agent` — an 11-package monorepo depending on `workspaces-effect`, `config-file-effect` and `xdg-effect`. It consumes `workspaces`, `config-file`, `xdg` and `store`, and transitively `walker` and `lockfiles`.
- `soda3js/tools` — specifically `@soda3js/config` (`dependencies: effect, smol-toml`), an Effect package whose job is loading and writing a TOML config file. It consumes `config-file` and `toml`. It needs **only** TOML: since [the config-file consolidation](package-inventory.md#the-config-file-consolidation-2026-07-11) the `config-file-toml` adapter it would have taken no longer exists, the `TomlCodec` arrives inside `@effected/config-file`, and this consumer carries dependency edges on `@effected/jsonc` and `@effected/yaml` that it never executes. It **provably pays nothing for them** — measured at 26.5 kB bundled, the TOML engine and neither of the others ([packages/config-file.md](packages/config-file.md#as-built-the-tree-shaking-property-is-measured-not-assumed)) — because an explicitly-composed codec is tree-shaken when unreferenced and, unbundled, ESM never loads a module nobody imports. **If either of those facts is ever falsified, this decision must be revisited** — this consumer is the one that would pay.

`@effected/ts-vfs` is load-bearing for two of the five — it is a migration target in its own right and `rspress-plugin-api-extractor` depends on it — which is why it never sequenced at the end. With everything else merged it is now simply **next**, and the only package left behind it is `app-kit`, which **no consumer is blocked on** because nothing may depend on it (a library taking an application control plane would be an [R2](effect-standards.md#dependency-policy) tier-3 leak).

## The gate

The union of what those consumers need. **Fifteen packages are merged today** (`semver`, `jsonc`, `yaml`, `package-json`, `npm`, `config-file`, `walker`, `glob`, `toml`, `lockfiles`, `store`, `xdg`, `runtime-resolver`, `runtime-resolver-cli`, `workspaces` — `pnpm-plugin-effect` is infrastructure and outside this count).

**The config-file consolidation is done** (2026-07-11): it dissolved three already-merged adapter packages into `@effected/config-file`, taking the merged count from eighteen to fifteen and the workspace from 19 packages to 16. It ran first, ahead of both ports, so the gate below, the remaining ports and every consumer's install instructions are written once against the final package set.

**Two pieces of work remain**, in this order, per the [migration order](package-inventory.md#migration-order): the **ts-vfs** port, then **app-kit**. The kit ships at `0.1.0` with **seventeen** library packages, not twenty.

| Package | Tier | Status | Why it is on the gate |
| --- | --- | --- | --- |
| `@effected/walker` | boundary | merged | `config-file`, `xdg` and `workspaces` all traverse paths |
| `@effected/glob` | pure | merged | `workspaces` drops its `minimatch` runtime dep for it |
| `@effected/lockfiles` | pure | merged | `workspaces` reads lockfiles |
| `@effected/store` | integrated | merged | SQLite cache + migrated state (`@effect/sql-sqlite-node`); `rspress-plugin-api-extractor` and `vitest-agent` both consume it |
| `@effected/xdg` | boundary | merged | `vitest-agent`, `ts-vfs`; zero runtime deps, and it does not depend on `store` |
| `@effected/workspaces` | integrated | merged | `vitest-agent`; takes `@pnpm/catalogs.*`, and implements `@effected/npm`'s resolver contracts |
| `@effected/runtime-resolver` | boundary | merged | a migration target; takes only `@effected/semver` and core `HttpClient` |
| `@effected/runtime-resolver-cli` | integrated | merged | the binary, split out so the library's consumers do not pay for `@effect/platform-node` |
| `@effected/toml` | pure | merged | `@soda3js/config`. Survived the consolidation — the format engine stays a package; only the adapter shim went |
| `@effected/config-file` | boundary | merged; **consolidated** | `vitest-agent` and `@soda3js/config`, which now takes it **alone** for TOML — it carries all four codecs (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`). Stays boundary tier: `@effected/*` edges do not propagate tier, only [R2](effect-standards.md#dependency-policy) tier-3 does |
| `@effected/ts-vfs` | integrated | **not started — next** | `rspress-plugin-api-extractor`, and a migration target. Renamed from `@effected/type-registry` |
| `@effected/app-kit` | integrated | **not started — last** | the composition layer over `xdg` + `config-file` + `store` (integrated via R2 over `store`). No consumer is blocked on it — nothing may depend on it |

### `@effected/toml` is a full-parity format package

**Re-specced 2026-07-10, superseding the 2026-07-09 rescope this section previously recorded** (parse/stringify-only over a vendored smol-toml port). `@effected/toml` is a full-parity sibling to `@effected/jsonc` and `@effected/yaml` — parse, stringify, Schema, lossless CST, edit-in-place, formatter, visitor — on a **from-scratch Effect-native engine** targeting TOML 1.0.0, with `smol-toml` appearing only as a devDependency test oracle. The gate consumer `@soda3js/config` still needs only parse/stringify: the consumer contract defines the minimum the package must satisfy, no longer its bound — the same reversal glob made of this section's original scoping precedent. [packages/toml.md](packages/toml.md) is authoritative.

### The config-file adapters dissolved before `0.1.0`

**Executed 2026-07-11.** `@effected/config-file-jsonc`, `-yaml` and `-toml` are deleted; `@effected/config-file` absorbed their three codecs. The `@effected/jsonc`, `@effected/yaml` and `@effected/toml` format packages were untouched. It ran ahead of the two remaining ports because it changed the shape of what `0.1.0` publishes, and everything downstream — the gate table above, the install instructions each of the five applications will follow, the release changesets — is cheaper to write once against the final set than to write twice.

Three adapter packages that existed only to hold a twenty-line object literal each were three packages to version, changeset, document and release for no gain a consumer could perceive. The install-weight argument that created them did not survive contact with how the codecs are actually composed (explicitly, by name, with no dispatch table) or with how pnpm actually installs (a content-addressed store with hardlinks). [package-inventory.md](package-inventory.md#the-config-file-consolidation-2026-07-11) records the evidence and [packages/config-file.md](packages/config-file.md#the-consolidation-2026-07-11) records the constraint that made it safe — the codecs are free-standing named exports with no namespace object, and the tree-shaking that rests on is now [measured](packages/config-file.md#as-built-the-tree-shaking-property-is-measured-not-assumed) rather than assumed.

**What it costs a release manager:** `@effected/config-file` is the only config-file package `0.1.0` publishes. Its accurate dependency property is **zero external runtime dependencies** — it peers on `@effected/jsonc`, `@effected/yaml`, `@effected/toml` and `@effected/walker`, all `@effected/*`, all pure or boundary — not the "zero runtime dependencies" the earlier drafts of this doc could claim.

### Not on the gate

- `@effected/json-schema` — its core value was superseded by v4's `Schema.toJsonSchemaDocument`, and `xdg`'s dependency on it was a dead facade. The xdg migration **cut it**, as predicted: nothing in the v3 `src/` used it, and it existed only to power a re-export facade the [no-barrel rule](effect-standards.md#no-barrel-re-exports) forbids anyway. The package is off the roadmap with no loose ends.

## Versioning

Every package stays below `1.0.0` until Effect v4 officially releases. Until then the `effect` peer range names the beta pinned in the `effect` catalog in `pnpm-workspace.yaml`, and a beta bump is a coordinated change across the whole kit rather than a per-package decision.

**One package is not bound to the coordinated `0.1.0`: `@effected/pnpm-plugin-effect`.** It is infrastructure, not a library — no library here depends on it and it depends on none — so it *may* publish on its own schedule. It has not: like every package in this repo it is `0.0.0` and `private: true`, and `npm view @effected/pnpm-plugin-effect` 404s. Nothing in this repo is on npm today. See [packages/pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md#publishing).

## Markdown

`rspress-plugin-api-extractor` already parses and emits markdown, via `mdast-util-from-markdown`, `mdast-util-to-hast` and `gray-matter`. A future `@effected/markdown` therefore has a real, identified consumer rather than a speculative one — reading and writing markdown at a low level is what AI-facing tooling does. It is still not a release gate: the plugin can keep its `mdast` dependencies and swap everything else. Sequenced after `0.1.0`.
