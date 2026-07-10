---
status: current
module: effected
category: meta
created: 2026-07-06
updated: 2026-07-09
last-synced: 2026-07-09
completeness: 88
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - releases.md
  - packages/semver.md
  - packages/jsonc.md
  - packages/yaml.md
  - packages/package-json.md
  - packages/npm.md
  - packages/config-file.md
  - packages/walker.md
  - packages/glob.md
---

# Package inventory

## Overview

Living map of source repos (under `/Users/spencer/workspaces/spencerbeggs/`) to target `@effected/*` packages. Status is updated as each migration lands, per step 7 of [migration-playbook.md](migration-playbook.md). Tier definitions are in [effect-standards.md](effect-standards.md); tier assignments and extraction candidates below reflect the completed reviews and are confirmed at migration time.

Which of these packages must exist before the kit ships, and which fall off the roadmap, is decided by the five consuming applications in [releases.md](releases.md) — not by the number of `*-effect` repos left. A source repo appearing here is not by itself a commitment to migrate it.

## Review findings (2026-07-06)

All ten source repos were reviewed against [effect-standards.md](effect-standards.md). Per-package reports live in `.claude/reviews/` and the cross-cutting synthesis in `.claude/reviews/SYNTHESIS.md`. The tier corrections, split decisions and provisional migration order below come from those reviews.

## Migration table

| Source repo | Target package | Tier (provisional) | Status | Notes |
| --- | --- | --- | --- | --- |
| semver-effect | @effected/semver | pure | merged | First migration; DX exemplar; design: [packages/semver.md](packages/semver.md) |
| jsonc-effect | @effected/jsonc | pure | merged | Second migration; design: [packages/jsonc.md](packages/jsonc.md); yaml parity convention recorded there; post-merge input-hardening applied (depth cap across five recursive surfaces), tracking issue #13 open for `parseTree` revalidation perf |
| yaml-effect | @effected/yaml | pure | merged | Third migration; design: [packages/yaml.md](packages/yaml.md); yaml/jsonc parity convention held except YamlFormattingOptions (see design) |
| json-schema-effect | @effected/json-schema | boundary | **off the roadmap** | Not on the [release gate](releases.md#not-on-the-gate): no consuming application needs it, and core JSON Schema generation is superseded by v4 `Schema.toJsonSchemaDocument`. Its only inbound edge, xdg's, is a dead facade that gets cut. Revisit only if a consumer appears |
| package-json-effect | @effected/package-json | integrated | implemented on `feat/package-json` (steps 3–4 complete); design: [packages/package-json.md](packages/package-json.md) | Split candidate reversed by review: stays one package with IO confined to a single `PackageJsonFile.ts` module (the v3 split motivation — the @effect/platform peer — evaporates in v4); a future split is a one-module extraction. Landed GREEN (34 v3 files → 13 src, 71/71 tests). Spins out a new internal sibling `@effected/npm` for the resolver contracts (see [internal packages](#internal-packages-no-source-repo) and [packages/npm.md](packages/npm.md)) |
| xdg-effect | @effected/xdg + @effected/store | boundary (xdg) + integrated (store) | not started | **Splits in two, decided 2026-07-09.** `@effected/xdg` keeps the XDG concepts only (`AppDirs`, `NativeDirs`, `XdgPaths`, `XdgSavePath`, the resolvers), expressed over `@effected/walker`. `@effected/store` takes the SQLite services. Its json-schema-effect dependency is a dead facade and gets cut |
| config-file-effect | @effected/config-file | boundary | implemented on `feat/config-file` (5a–5c landed: core + `-jsonc` + `-yaml` adapters, playbook steps 3–4 complete); design: [packages/config-file.md](packages/config-file.md) | Error-model redesign (one stringly mega-error → eight `Schema.TaggedErrorClass` types with narrowed per-method unions, one — `ConfigDefaultPathMissingError` — added at port time) is the headline work. JSON codec in core; core carries **zero runtime deps**. The review's subpath-export plan is **superseded**: subpath exports are not used in this monorepo, so each optional dep becomes a package — the migration expands into a family (see [config-file family](#the-config-file-family)). Landed GREEN: core 111 tests, `-jsonc` adapter 4 tests, `-yaml` adapter 5 tests; whole-repo gate typecheck 15/15, build 28/28, tests 1830/1830. Watcher deferred to its own cycle and needs redesign, not translation. Confirmed it does NOT depend on json-schema-effect |
| workspaces-effect | @effected/workspaces + @effected/lockfiles | integrated (workspaces) + pure (lockfiles) | not started | @effected/lockfiles extraction confirmed clean (pure tier) after two pre-repairs: importer-path→name resolution moves out of the lockfile reader and integrity checking becomes pure. Post-extraction workspaces keeps discovery, the dependency graph, change detection and package-manager detection. Its `@pnpm/catalogs.*` deps **stay** — they are what make workspaces integrated tier; a `@effected/pnpm-catalogs` split is a later one-module extraction if anything ever asks. `minimatch` is dropped as an **npm dependency** in favour of `@effected/glob`: both its call sites — `WorkspacePackage.matchesDependency` and the `packages:` pattern enumerator — retarget onto the vendored engine (see [glob](#internal-packages-no-source-repo)) |
| type-registry-effect | @effected/type-registry | integrated | not started | TypeRegistry facade becomes a Context.Service; createTypeScriptCache extraction candidate; @effect/sql surface is entirely indirect and collapses behind @effected/xdg; unused semver-effect dependency to remove-or-use |
| runtime-resolver | @effected/runtime-resolver | boundary (+ integrated CLI split) | not started | Core takes only @effected/semver, so it is boundary; its @effect/cli binary is tier 3 and moves to a separate integrated CLI package rather than making the resolver's own consumers pay a tier-3 install (this is what R1 requires, not an ad-hoc fix); depends on @effected/semver so it sequences after semver |

Extraction candidates recorded above are surfaced by review; final decisions land during each migration's design.

## Cross-package realignment (2026-07-08)

`chore/realignment` is a cross-package cleanup pass over the five landed packages (semver, jsonc, yaml, package-json, npm), not a new migration. Three shifts touch package state:

- **Inline API-Extractor factories everywhere.** All five packages were converted from the transitional `@public X_base` idiom to the inline class-factory form with a narrow `_base` suppression in each `savvy.build.ts`, per the [effect-standards API-Extractor policy](effect-standards.md#api-extractor--effect-class-factories). The `@public X_base` backlog is fully cleared; every package retains a zero-warning `issues.json`.
- **yaml input-hardening extended.** Beyond the composer/CST depth caps already recorded in [packages/yaml.md](packages/yaml.md), two more defect surfaces now fail typed: an alias-expansion "billion laughs" bomb that stayed under `maxAliasCount` but OOM-crashed the heap (now bounded by a materialized-node budget, fatal `AliasCountExceeded`), and deep-input stack overflows in `Yaml.stringify` (value path) and `YamlDocument.stringify` (node path), now capped at `MAX_NESTING_DEPTH = 256` (fatal `NestingDepthExceeded`).
- **Structured error shapes.** jsonc's `JsoncModificationError` moved from a `reason: string` to typed `expected`/`depth` fields (the structure-preserving-errors house rule; yaml's `YamlModificationError` was already compliant), and package-json's `ScopedPackageName`/`UnscopedPackageName`/`SpdxLicense` branded types now export as `string & Brand.Brand<…>` rather than `typeof X.Type`.

## Internal packages (no source repo)

Packages created inside the monorepo rather than migrated from a `*-effect` source repo, so they carry no migration-table row:

- `@effected/npm` (pure tier) — extracted from the `@effected/package-json` port to hold the dependency-resolution service contracts (`CatalogResolver`, `WorkspaceResolver`) and `DependencyResolutionError` that package-json defines but cannot implement. Initial surface is exactly what package-json's port needs; it expands when `@effected/workspaces`/`@effected/lockfiles` land. **Implemented on `feat/package-json` (landed alongside the package-json port, 11/11 tests green).** Design: [packages/npm.md](packages/npm.md).
- `@effected/toml` (pure tier) — a TOML format package, sibling to `@effected/jsonc` and `@effected/yaml`. Surfaced by the `@effected/config-file` design: with subpath exports off the table, the TOML codec needs a package. **Rescoped 2026-07-09 to `parse` / `stringify` / Schema.** The full-parity CST/edit/format/visitor pipeline is *not* built: its one known consumer, `@soda3js/config`, imports exactly `parse` and `stringify`. Built zero-dep with a ported-with-attribution `smol-toml` engine (BSD-3-Clause, zero-dependency, 211KB unpacked — jsonc's scale) vendored into `src/internal/`, hardened per the `hardening-a-parser-port` skill. Vendoring is what the pure-tier [dependency policy](effect-standards.md#dependency-policy) requires and is also the fast path; a from-scratch engine is an optional later replacement. **Not started**; its own spec → plan → implement cycle. On the [release gate](releases.md#the-gate).
- `@effected/walker` (boundary tier) — **migration #6**, upward path traversal: ascend-to-root iteration, first-match-upward probing and root-anchored discovery (marker predicate plus subpath probing). **Boundary, not pure**: it does IO through `effect`-core `FileSystem`/`Path` (arriving via the `R` channel), which under the [three-tier taxonomy](effect-standards.md#three-tier-library-taxonomy) is boundary tier — requiring core services costs no dependency, so walker stays tier 2 with an `effect`-only peer and zero runtime deps. Extracted from `@effected/config-file`'s `internal/walkUp.ts` (`ascend`, `findUpward`) and `ConfigResolver.ts`'s `rootAnchored`/`probeSubpaths` helpers. **Correcting the prior claim in this list:** walker's sources are *not* "the same algorithm pointed in opposite directions" as workspaces-effect's `glob-core.ts`. `glob-core.ts` is pure glob compilation with no IO, and the downward enumeration is a separate loop in `WorkspaceDiscoveryLive.resolvePatterns` — three things, not two. Walker v1 is **upward only**; glob matching moves to `@effected/glob` and downward enumeration stays in workspaces. Consumers: `config-file`, `xdg`, `workspaces`. Carries the per-probe error-absorption contract — one unreadable ancestor must not abort an ascent. **Merged — 25 tests**, zero-warning `dist/prod/issues.json` (the first package in the repo with a genuinely empty suppression list). Design: [packages/walker.md](packages/walker.md).
- `@effected/glob` (pure tier) — **added to the roadmap 2026-07-09**, a glob-matching package sibling to `@effected/jsonc`/`@effected/yaml`. Vendors a ported-with-attribution `minimatch` engine into `src/internal/` per the [pure-tier dependency policy](effect-standards.md#dependency-policy) ([R1](effect-standards.md#dependency-policy)): minimatch 10.2.5 (BlueOak-1.0.0, ~2,180 lines) plus brace-expansion 5 (MIT, ~200 lines) and balanced-match 4 (MIT, ~60) — ~2,450 lines and three attributions, between jsonc (1,245) and yaml (9,973) in scale. **No IO, still tier 1** — under three tiers, pure is a dependency statement, not an IO one, so a no-IO package vendors its engine because of R1, not because it lacks IO. The hardening bill is real: brace expansion has a ReDoS history (CVE-2022-3517), and both the brace expander and `ast.ts` are recursive, so `hardening-a-parser-port` applies in full — depth guards on every recursion surface, malformed patterns fail through a typed error channel, never a defect or a hang. Consumer: `@effected/workspaces` only — both `WorkspacePackage.matchesDependency` (which drops its `minimatch` runtime dep) and the `packages:` pattern enumerator. It must **not** carry forward `glob-core.ts`'s known degradation of silently rewriting a trailing `/**` to `/*` (workspaces issue #62); the enumerator owes a bounded recursive descent instead. Built as its **own spec → plan → implement cycle immediately after `@effected/walker`**, while the minimatch dialect and CVE analysis are fresh; it has no consumer until `workspaces`. **Merged — 134 tests** (a 130-row oracle-cross-checked compliance table, oracle property tests against the real minimatch pinned at 10.2.5 as a devDependency, and a hostile-input suite), zero-warning `dist/prod/issues.json` with only the four synthesized base symbols suppressed. The port surfaced a genuine upstream hole: stock minimatch 10.2.5 stack-overflows at default options on a coalescible extglob adoption chain under its own 64KB cap; the vendored engine adds a structural parse-depth backstop that fails it typed. Design: [packages/glob.md](packages/glob.md).
- `@effected/store` (integrated tier — `@effect/sql-sqlite-node`) — extracted from xdg-effect. Two services over one primitive: a `Store` (a schema-versioned, migrated `SqlClient` rooted at an `AppDirs`-supplied path) and a `Cache` built on it (a `Store` with a fixed `key → Uint8Array` schema, a TTL and an eviction policy, plus the `CacheEvent` stream). Named for the primitive, not the backend, so a non-SQLite implementation never forces a rename — and not `@effected/cache`, which would shadow `effect`'s own `Cache` module in every import list. The two are genuinely different: an evicted cache entry is correct behaviour, a lost state row is a bug. **Not started.**
- `@effected/app-kit` (integrated tier — via [R2](effect-standards.md#dependency-policy) over `@effected/store`) — a **thin composition layer**, explicitly not an umbrella. One Layer wiring `@effected/xdg`, `@effected/config-file` and `@effected/store` into an application control plane, plus only the glue that exists when all three are present. It owns no domain logic and **re-exports nothing** — a consumer wanting config files alone takes `config-file` alone, and the [no-barrel-re-exports](effect-standards.md#no-barrel-re-exports) rule holds. This is what `xdg-effect` was being used as. **Not started.**
- `@effected/lockfiles` (pure tier) — extracted from workspaces-effect: the bun/npm/pnpm/yarn lockfile parsers plus integrity checking, after the two pre-repairs the review identified (importer-path→name resolution moves out of the reader; integrity becomes pure). Depends on `@effected/jsonc`, `@effected/yaml` and `@effected/semver` — pure-to-pure `workspace:*` edges, which the dependency policy permits. Pure **assuming its IO surface stays out of the parsers** — confirm that at migration time, since a lockfile reader that reaches for the filesystem itself would be boundary. **Not started.**
- `@effected/pnpm-plugin-effect` (infra) — the pnpm config dependency (built with `rolldown-pnpm-config`) that publishes the `effect` and `effectPeers` catalogs every `@effected/*` package pins against, and the source of truth for the workspace peer discipline. Maintained via `pnpm pnpm:up` / `pnpm:export`. Pre-existing repo infrastructure; design doc and initial-release changeset added on `feat/package-json`. Design: [packages/pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md).

## Migration order (provisional)

Dependency sequencing from the review synthesis (`.claude/reviews/SYNTHESIS.md`), rescoped 2026-07-09 by the [release gate](releases.md#the-gate). Merged work is fixed; the order after it firms up as lessons land, per [migration-playbook.md](migration-playbook.md).

Merged: 1. semver — 2. jsonc — 3. yaml — 4. package-json (+ npm) — 5. config-file (+ `-jsonc`, `-yaml`) — 6. walker — 7. glob.

Remaining, nine packages:

1. **toml**, then **config-file-toml** — closes the config-file family. The adapter is a ~20-line follow-on over the stable `ConfigCodec` seam.
2. **lockfiles** — pure, no inbound blockers.
3. **store** — extracted from xdg; needed by type-registry and both external consumers.
4. **xdg** — after store, so it lands already slim.
5. **workspaces** — after glob and lockfiles.
6. **app-kit** — after xdg, config-file and store; it composes them and adds nothing else.
7. **type-registry** — load-bearing for two consuming apps, so not last.
8. **runtime-resolver** (+ CLI split) — depends only on semver, so it can move earlier if convenient.

`json-schema` is off the roadmap entirely.

### The config-file family

Because this monorepo does not use subpath exports, every optional dependency of `@effected/config-file` becomes a package boundary. Migration #5 therefore delivers a family rather than a package, each member on its own spec → plan → implement cycle:

| Package | Tier | Order | Status | Depends on |
| --- | --- | --- | --- | --- |
| `@effected/config-file` (core pipeline + JSON codec) | boundary | 5a | **done** — 111 tests | `effect` (peer); gains `@effected/walker` |
| `@effected/config-file-jsonc` | pure | 5b | **done** — 4 tests | `@effected/jsonc`, `@effected/config-file` |
| `@effected/config-file-yaml` | pure | 5c | **done** — 5 tests | `@effected/yaml`, `@effected/config-file` |
| `@effected/toml` | pure | 5d | not started — on the gate | vendored engine, no runtime deps |
| `@effected/config-file-toml` | pure | 5e | not started — on the gate | `@effected/toml`, `@effected/config-file` |
| `@effected/config-file-watcher` | boundary | 5f | not started — **off the gate** | `@effected/config-file` |

5a–5c landed together on `feat/config-file`; the core does not depend on `@effected/toml`, so the TOML port does not block migration #5. Dependency direction is strictly acyclic: config-file → format packages, never the reverse. 5d–5e are on the [release gate](releases.md#the-gate) — `@soda3js/config` is the TOML consumer that puts them there. 5f is not on the gate and needs redesign rather than translation.

When `@effected/walker` lands, `config-file`'s `internal/walkUp.ts` is deleted and its `ConfigResolver` strategies are re-expressed over walker's primitives. This is a real change to an already-merged, currently zero-dependency package; nothing is published, so the cost is a refactor commit, not a breaking release.

## External consumers (stay in their own repos)

Downstream projects that consume published `@effected` packages but do not migrate in, per the libraries-only scope in [architecture.md](architecture.md). Three of these define the [release gate](releases.md#the-five-applications):

- rolldown-pnpm-config
- **vitest-agent** — gate consumer: `workspaces`, `config-file`, `xdg`, `store`
- **rspress-plugin-api-extractor** — gate consumer: `semver`, `type-registry`, `store`. Note the published package is `plugin/`, not the repo root
- **soda3js/tools** — gate consumer, via `@soda3js/config`: `config-file`, `config-file-toml`, `toml`
- the `@savvy-web/*` silk system (silk-*-action repos)
