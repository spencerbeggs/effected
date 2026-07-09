---
status: current
module: effected
category: meta
created: 2026-07-06
updated: 2026-07-09
last-synced: 2026-07-09
completeness: 87
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - packages/semver.md
  - packages/jsonc.md
  - packages/yaml.md
  - packages/package-json.md
  - packages/npm.md
  - packages/config-file.md
---

# Package inventory

## Overview

Living map of source repos (under `/Users/spencer/workspaces/spencerbeggs/`) to target `@effected/*` packages. Status is updated as each migration lands, per step 7 of [migration-playbook.md](migration-playbook.md). Tier definitions are in [effect-standards.md](effect-standards.md); tier assignments and extraction candidates below reflect the completed reviews and are confirmed at migration time.

## Review findings (2026-07-06)

All ten source repos were reviewed against [effect-standards.md](effect-standards.md). Per-package reports live in `.claude/reviews/` and the cross-cutting synthesis in `.claude/reviews/SYNTHESIS.md`. The tier corrections, split decisions and provisional migration order below come from those reviews.

## Migration table

| Source repo | Target package | Tier (provisional) | Status | Notes |
| --- | --- | --- | --- | --- |
| semver-effect | @effected/semver | pure | merged | First migration; DX exemplar; design: [packages/semver.md](packages/semver.md) |
| jsonc-effect | @effected/jsonc | pure | merged | Second migration; design: [packages/jsonc.md](packages/jsonc.md); yaml parity convention recorded there; post-merge input-hardening applied (depth cap across five recursive surfaces), tracking issue #13 open for `parseTree` revalidation perf |
| yaml-effect | @effected/yaml | pure | merged | Third migration; design: [packages/yaml.md](packages/yaml.md); yaml/jsonc parity convention held except YamlFormattingOptions (see design) |
| json-schema-effect | @effected/json-schema | boundary | not started | File writes are load-bearing for silk-release-action; core JSON Schema generation superseded by v4 `Schema.toJsonSchemaDocument` — remaining value is TOML tooling (tombi/taplo builders, Ajv validation, scaffolder); one package, Scaffold/Tombi/Taplo seam available if split later |
| package-json-effect | @effected/package-json | boundary | implemented on `feat/package-json` (steps 3–4 complete); design: [packages/package-json.md](packages/package-json.md) | Split candidate reversed by review: stays one package with IO confined to a single `PackageJsonFile.ts` module (the v3 split motivation — the @effect/platform peer — evaporates in v4); a future split is a one-module extraction. Landed GREEN (34 v3 files → 13 src, 71/71 tests). Spins out a new internal sibling `@effected/npm` for the resolver contracts (see [internal packages](#internal-packages-no-source-repo) and [packages/npm.md](packages/npm.md)) |
| xdg-effect | @effected/xdg | boundary | not started | Extraction candidate: SQLite cache/state services → a separate @effected sqlite package (name TBD at migration); post-extraction xdg is a small fs+env boundary lib; its json-schema-effect dependency is a dead facade and gets cut |
| config-file-effect | @effected/config-file | boundary | implemented on `feat/config-file` (5a–5c landed: core + `-jsonc` + `-yaml` adapters, playbook steps 3–4 complete); design: [packages/config-file.md](packages/config-file.md) | Error-model redesign (one stringly mega-error → eight `Schema.TaggedErrorClass` types with narrowed per-method unions, one — `ConfigDefaultPathMissingError` — added at port time) is the headline work. JSON codec in core; core carries **zero runtime deps**. The review's subpath-export plan is **superseded**: subpath exports are not used in this monorepo, so each optional dep becomes a package — the migration expands into a family (see [config-file family](#the-config-file-family)). Landed GREEN: core 111 tests, `-jsonc` adapter 4 tests, `-yaml` adapter 5 tests; whole-repo gate typecheck 15/15, build 28/28, tests 1830/1830. Watcher deferred to its own cycle and needs redesign, not translation. Confirmed it does NOT depend on json-schema-effect |
| workspaces-effect | @effected/workspaces | boundary | not started | @effected/lockfiles extraction confirmed clean (pure tier) after two pre-repairs: importer-path→name resolution moves out of the lockfile reader and integrity checking becomes pure |
| type-registry-effect | @effected/type-registry | boundary | not started | TypeRegistry facade becomes a Context.Service; createTypeScriptCache extraction candidate; @effect/sql surface is entirely indirect and collapses behind @effected/xdg; unused semver-effect dependency to remove-or-use |
| runtime-resolver | @effected/runtime-resolver | boundary | not started | Boundary confirmed (already Effect v3 internally); new split candidate: its @effect/cli binary moves to a separate CLI package (peers currently leak onto API consumers); depends on @effected/semver so it sequences after semver |

Extraction candidates recorded above are surfaced by review; final decisions land during each migration's design.

## Cross-package realignment (2026-07-08)

`chore/realignment` is a cross-package cleanup pass over the five landed packages (semver, jsonc, yaml, package-json, npm), not a new migration. Three shifts touch package state:

- **Inline API-Extractor factories everywhere.** All five packages were converted from the transitional `@public X_base` idiom to the inline class-factory form with a narrow `_base` suppression in each `savvy.build.ts`, per the [effect-standards API-Extractor policy](effect-standards.md#api-extractor--effect-class-factories). The `@public X_base` backlog is fully cleared; every package retains a zero-warning `issues.json`.
- **yaml input-hardening extended.** Beyond the composer/CST depth caps already recorded in [packages/yaml.md](packages/yaml.md), two more defect surfaces now fail typed: an alias-expansion "billion laughs" bomb that stayed under `maxAliasCount` but OOM-crashed the heap (now bounded by a materialized-node budget, fatal `AliasCountExceeded`), and deep-input stack overflows in `Yaml.stringify` (value path) and `YamlDocument.stringify` (node path), now capped at `MAX_NESTING_DEPTH = 256` (fatal `NestingDepthExceeded`).
- **Structured error shapes.** jsonc's `JsoncModificationError` moved from a `reason: string` to typed `expected`/`depth` fields (the structure-preserving-errors house rule; yaml's `YamlModificationError` was already compliant), and package-json's `ScopedPackageName`/`UnscopedPackageName`/`SpdxLicense` branded types now export as `string & Brand.Brand<…>` rather than `typeof X.Type`.

## Internal packages (no source repo)

Packages created inside the monorepo rather than migrated from a `*-effect` source repo, so they carry no migration-table row:

- `@effected/npm` (pure tier) — extracted from the `@effected/package-json` port to hold the dependency-resolution service contracts (`CatalogResolver`, `WorkspaceResolver`) and `DependencyResolutionError` that package-json defines but cannot implement. Initial surface is exactly what package-json's port needs; it expands when `@effected/workspaces`/`@effected/lockfiles` land. **Implemented on `feat/package-json` (landed alongside the package-json port, 11/11 tests green).** Design: [packages/npm.md](packages/npm.md).
- `@effected/toml` (pure tier) — a full-parity TOML format package (parse/stringify/Schema plus the CST/edit/format/visitor pipeline), sibling to `@effected/jsonc` and `@effected/yaml`. Surfaced by the `@effected/config-file` design: with subpath exports off the table, the TOML codec needs a package, and a `smol-toml` wrapper would make it the first `@effected` format package with a runtime dependency. Built zero-dep with a ported-with-attribution internal engine, hardened per the `hardening-a-parser-port` skill. **Not started**; its own spec → plan → implement cycle, sequenced after `@effected/config-file` (which does not depend on it — only the toml adapter does).
- `@effected/pnpm-plugin-effect` (infra) — the pnpm config dependency (built with `rolldown-pnpm-config`) that publishes the `effect` and `effectPeers` catalogs every `@effected/*` package pins against, and the source of truth for the workspace peer discipline. Maintained via `pnpm pnpm:up` / `pnpm:export`. Pre-existing repo infrastructure; design doc and initial-release changeset added on `feat/package-json`. Design: [packages/pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md).

## Migration order (provisional)

Dependency sequencing from the review synthesis (`.claude/reviews/SYNTHESIS.md`). semver first is decided; the order after it firms up as lessons land, per [migration-playbook.md](migration-playbook.md).

1. semver
2. jsonc
3. yaml
4. package-json
5. config-file (+ the config-file family, below)
6. xdg (+ SQLite extraction)
7. json-schema
8. workspaces (+ @effected/lockfiles extraction)
9. type-registry
10. runtime-resolver (+ CLI split)

### The config-file family

Because this monorepo does not use subpath exports, every optional dependency of `@effected/config-file` becomes a package boundary. Migration #5 therefore delivers a family rather than a package, each member on its own spec → plan → implement cycle:

| Package | Tier | Order | Status | Depends on |
| --- | --- | --- | --- | --- |
| `@effected/config-file` (core pipeline + JSON codec) | boundary | 5a | **done** — 111 tests | `effect` (peer) only |
| `@effected/config-file-jsonc` | pure | 5b | **done** — 4 tests | `@effected/jsonc`, `@effected/config-file` |
| `@effected/config-file-yaml` | pure | 5c | **done** — 5 tests | `@effected/yaml`, `@effected/config-file` |
| `@effected/toml` | pure | 5d | not started | — |
| `@effected/config-file-toml` | pure | 5e | not started | `@effected/toml`, `@effected/config-file` |
| `@effected/config-file-watcher` | boundary | 5f | not started | `@effected/config-file` |

5a–5c landed together on `feat/config-file`; the core does not depend on `@effected/toml`, so the full-parity TOML port does not block migration #5. Dependency direction is strictly acyclic: config-file → format packages, never the reverse. 5d–5f remain, each still its own spec → plan → implement cycle.

## External consumers (stay in their own repos)

Downstream projects that consume published `@effected` packages but do not migrate in, per the libraries-only scope in [architecture.md](architecture.md):

- rolldown-pnpm-config
- vitest-agent
- rspress-plugin-api-extractor
- the `@savvy-web/*` silk system (silk-*-action repos)
