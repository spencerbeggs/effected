---
status: current
module: effected
category: meta
created: 2026-07-06
updated: 2026-07-26
last-synced: 2026-07-26
completeness: 88
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - releases.md
  - roadmap.md
  - packages/semver.md
  - packages/jsonc.md
  - packages/yaml.md
  - packages/package-json.md
  - packages/npm.md
  - packages/config-file.md
  - packages/walker.md
  - packages/glob.md
  - packages/toml.md
  - packages/lockfiles.md
  - packages/store.md
  - packages/xdg.md
  - packages/workspaces.md
  - packages/runtimes.md
  - packages/app.md
  - packages/tsconfig-json.md
  - packages/git.md
  - packages/spdx.md
  - packages/pnpm-plugin-effect.md
  - packages/markdown.md
  - packages/commands.md
  - packages/templates.md
  - packages/github.md
  - packages/github-actions.md
  - packages/sbom.md
  - consumers/README.md
---

# Package inventory

## Overview

The current `@effected/*` package set and where each package came from. The kit is **twenty-five publishable packages** — twenty-four libraries plus the `pnpm-plugin-effect` [companion](effect-standards.md#companion-packages-published-but-not-a-library). All twenty-five have published: the five from the [github-split program](#the-github-split-packages) joined the release stream in the 2026-07-26 wave ([releases.md](releases.md#the-github-split-wave)), closing the last unpublished gap. Tier definitions are in [effect-standards.md](effect-standards.md); the release history and consumer mapping are in [releases.md](releases.md); post-`0.1.0` work is in [roadmap.md](roadmap.md). Each package's own design doc under `packages/` is authoritative for its API and as-built decisions.

The kit's scope is closed by the consuming applications in [releases.md](releases.md), not by the number of `*-effect` source repos. A source repo is not by itself a commitment to migrate it: `json-schema-effect` fell off under that test (see [Off the roadmap](#off-the-roadmap)).

## The packages

Provenance is one of: **port** (redesigned from a v3 `*-effect` source repo under `/Users/spencer/workspaces/spencerbeggs/`, or from a `@savvy-web/*` package), **extraction** (carved out of another package during its port), **part-port** (one service generalized out of a source package, the rest invented) or **invention** (new, scoped by a consumer survey rather than a source repo).

All twenty-five published packages — nineteen of them were the `0.1.0` gate set ([releases.md](releases.md#the-gate)); `markdown` joined the release stream in the 2026-07-19 wave, and the github-split five joined it in the 2026-07-26 wave (sixteen packages, release PR #181) — the second worked example of how a package that was never on the gate ships:

| Package | Tier | Provenance | Design doc |
| --- | --- | --- | --- |
| `@effected/semver` | pure | port of `semver-effect`; the DX exemplar | [packages/semver.md](packages/semver.md) |
| `@effected/jsonc` | pure | port of `jsonc-effect` | [packages/jsonc.md](packages/jsonc.md) |
| `@effected/yaml` | pure | port of `yaml-effect`; largest package in the repo | [packages/yaml.md](packages/yaml.md) |
| `@effected/package-json` | boundary | port of `package-json-effect`; IO confined to one `PackageJsonFile.ts` module, SPDX validity delegated to `@effected/spdx` | [packages/package-json.md](packages/package-json.md) |
| `@effected/npm` | boundary (was pure) | extraction from `package-json`; holds the `CatalogResolver`/`WorkspaceResolver` contracts and the dependency-resolution vocabulary, plus the `NpmRegistry`/`PackagePublish` services added 2026-07-25 | [packages/npm.md](packages/npm.md) |
| `@effected/config-file` | boundary | port of `config-file-effect`; carries the four codecs as free-standing named exports | [packages/config-file.md](packages/config-file.md) |
| `@effected/walker` | boundary | extraction from `config-file`; upward path traversal | [packages/walker.md](packages/walker.md) |
| `@effected/glob` | pure | invention; vendored minimatch dialect as pure string→predicate schemas | [packages/glob.md](packages/glob.md) |
| `@effected/toml` | pure | invention; TOML 1.0.0 on a from-scratch engine | [packages/toml.md](packages/toml.md) |
| `@effected/lockfiles` | pure | extraction from `workspaces`; bun/npm/pnpm/yarn parsers and integrity checking | [packages/lockfiles.md](packages/lockfiles.md) |
| `@effected/store` | integrated | extraction from `xdg`; migrated SQLite `Store` and TTL `Cache` | [packages/store.md](packages/store.md) |
| `@effected/xdg` | boundary | port of `xdg-effect`; XDG concepts over `walker`, does not depend on `store` | [packages/xdg.md](packages/xdg.md) |
| `@effected/workspaces` | integrated | port of `workspaces-effect`; discovery, dependency graph, catalogs, change detection | [packages/workspaces.md](packages/workspaces.md) |
| `@effected/runtimes` | boundary | port of `runtime-resolver` (the library half); resolve Node/Bun/Deno versions | [packages/runtimes.md](packages/runtimes.md) |
| `@effected/tsconfig-json` | boundary | invention; read/resolve/construct tsconfig.json with zero `typescript` imports | [packages/tsconfig-json.md](packages/tsconfig-json.md) |
| `@effected/git` | boundary | invention; typed git introspection plus a marked mutating tier over core's `ChildProcessSpawner` | [packages/git.md](packages/git.md) |
| `@effected/spdx` | pure | invention; vendored SPDX license expressions as pure schemas; consumed by `package-json` | [packages/spdx.md](packages/spdx.md) |
| `@effected/app` | integrated | invention; thin composition over `xdg` + `config-file` + `store` | [packages/app.md](packages/app.md) |
| `@effected/markdown` | pure | invention; CommonMark + GFM as pure schemas, the kit's typed communication layer with AI agents | [packages/markdown.md](packages/markdown.md) |
| `@effected/commands` | boundary | part-port of `@savvy-web/silk-effects`' `ToolDiscovery` plus invention; tool discovery and structured running over core's `ChildProcessSpawner` | [packages/commands.md](packages/commands.md) |
| `@effected/templates` | boundary | port of `@savvy-web/silk-effects`' `ManagedSection`; managed `BEGIN`/`END` blocks in user-owned files | [packages/templates.md](packages/templates.md) |
| `@effected/github` | integrated | port-with-redesign of `@savvy-web/github-action-effects`' GitHub half; owns the octokit runtime | [packages/github.md](packages/github.md) |
| `@effected/github-actions` | integrated | port-with-redesign of the same package's Actions half; the runner-side runtime | [packages/github-actions.md](packages/github-actions.md) |
| `@effected/sbom` | integrated | port-with-redesign of the same package's `Attest` knot; owned CycloneDX 1.6 emitter plus Sigstore signing | [packages/sbom.md](packages/sbom.md) |
| `@effected/pnpm-plugin-effect` | companion — no tier | invention; publishes the `effect`/`effectPeers` catalogs | [packages/pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md) |

Tiers classify libraries by dependency surface; the companion is not a library and carries no tier. Notable structural facts that recur across the kit:

- **`app` is a thin composition layer, not an umbrella.** It wires `xdg`, `config-file` and `store` into an application control plane and the glue that exists only when all three are present. It owns no domain logic, defines no service/schema/error and **re-exports nothing** — a consumer wanting config files alone takes `config-file` alone, so the [no-barrel-re-exports](effect-standards.md#no-barrel-re-exports) rule holds. Nothing may depend on it: a library taking an application control plane would be an [R2](effect-standards.md#dependency-policy) tier-3 leak.
- **`npm`'s contracts are implemented by `workspaces`.** `package-json` defines `CatalogResolver`/`WorkspaceResolver` but cannot implement them; `workspaces` ships the layers, because catalog resolution needs `pnpm-workspace.yaml` plus the lockfile and workspace-version resolution needs the discovered package list. Provide either alongside `Package.resolve` and a manifest's `catalog:` / `workspace:` specifiers resolve for real. The same inversion now runs twice: `commands` declares `LocalExec` and `workspaces` ships that layer too ([packages/workspaces.md](packages/workspaces.md)).
- **`npm` is boundary, not integrated, and a guardrail keeps it there.** Its `NpmRegistry`/`PackagePublish` services do IO themselves through core-declared contracts in `R`, which is what boundary means (R4) — but only while they stay core-contracts-plus-`commands`. The first non-core runtime dependency makes the package integrated, and R2 would then drag `lockfiles` (pure) and `package-json` (boundary) with it; the recorded answer to that day is a split, not an accepted retier. The rule and its reachability test are in [packages/npm.md](packages/npm.md#the-tier-ruling-pure--boundary-deliberately-with-a-guardrail).
- **`workspaces`' `@pnpm/catalogs.*` deps are what make it integrated**, confined to one internal module so the tier-3 blast radius is a single file. Its git reads run through `@effected/git` (`ChangeDetector` and the snapshot service), one boundary edge that keeps it integrated.
- **`store` is named for its primitive, not its backend** — a schema-versioned migrated `SqlClient` and a `key → Uint8Array` cache sharing one migration-ledger engine, so a non-SQLite implementation never forces a rename. Its single `@effect/sql-sqlite-node` dependency is what makes it tier 3, and is why the SQLite services were split out of `xdg`.

## The four codecs live in `config-file`

`@effected/config-file` absorbs all four config codecs — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec` — as free-standing named exports, one module each, with **no namespace object**. `ConfigCodec` is the interface only. This is what keeps them tree-shakeable, [measured not assumed](packages/config-file.md#the-load-bearing-constraint-free-standing-named-exports-never-a-namespace-object): a `JsonCodec`-only consumer bundles a few hundred bytes; a namespace object would drag every engine into every consumer. The rule and its rationale live in [effect-standards.md](effect-standards.md#no-barrel-re-exports).

The `jsonc`, `yaml` and `toml` **format** packages remain independent — they are pure format engines with no knowledge of `config-file`, so the dependency direction stays strictly acyclic (`config-file` → format packages, never the reverse). `config-file` carries **zero external runtime dependencies**: it peers on `jsonc`, `yaml`, `toml` and `walker`, all pure or boundary `@effected/*`.

## The github-split packages

Five packages joined the kit through the [github-split program](releases.md#the-github-split-wave) — `commands`, `templates`, `github`, `github-actions` and `sbom`, listed with the rest of the published set in the main table above. They sat unpublished only because the program ran without changesets by design; the **2026-07-26 wave** (release PR #181, sixteen packages) named them and they published at `0.1.0` each, alongside eleven extended packages. [releases.md](releases.md#the-github-split-wave) carries the wave's exact versions.

The program (2026-07-25, plan `2026-07-25-github-split-master.md`; plans are local-only, so cite by name) replaces `@savvy-web/github-action-effects` wholesale and upstreams the mechanism half of `@savvy-web/silk-effects`. Its consumer migration maps and the Phase 6 fluency audit are under [consumers/](consumers/README.md).

Three structural facts from it recur, each argued in the package's own doc:

- **`github-actions` is the one package with a required `@effect/platform-node` peer**, and the only one licensed to import `node:` directly. An action always compiles into a Node process on a GitHub-provided runner, so there is no second platform to abstract over; the licence is scoped to that overlay and does not generalize. `@azure/storage-blob` is confined to three modules, so a consumer importing `ActionOutputs` cannot link it.
- **`commands` stays boundary only because the workspaces edge inverts.** A direct `commands` → `workspaces` edge would have made four packages integrated, a pure one among them.
- **`sbom` declines `@cyclonedx/cyclonedx-library` (6.6 MB, seven optional peers) and owns its emitter** — the `toml`/`glob` economics again, with the added reason that the library's `spdx-expression-parse` peer is the engine [`@effected/spdx`](packages/spdx.md) exists to replace.

The program also **extended five published packages** rather than adding to them: `npm` (retiered, above), `workspaces` (release/tracking tags, versioning strategy, the `LocalExec` layer and the publishability seam), `config-file` (`ConfigFile.read`), `package-json` (the location fields, and the `Person` stale-wire fix) and `markdown` (the section finders). Each package's doc carries its own as-built section.

## Not in the kit

- `@effected/ts-vfs` (port of `type-registry-effect`) — ported, then returned to the external `type-registry-effect` repo, where its consumer `rspress-plugin-api-extractor` consumes it from source. It carries the `typescript@^6` / `@typescript/vfs` peers, so keeping it out preserves the kit's "no `@effected/*` package imports `typescript`" posture. See [releases.md](releases.md#the-five-applications).
- `@effected/runtime-resolver-cli` — the `runtime-resolver` binary re-ships from the external `runtime-resolver` repo against the published `@effected/runtimes`, so the library's consumers never install `@effect/platform-node`. See [packages/runtimes.md](packages/runtimes.md).

## Off the roadmap

- `@effected/json-schema` — its core value is superseded by v4's `Schema.toJsonSchemaDocument`, and `xdg`'s dependency on it was a dead facade that was cut. Revisit only if a consuming application appears.

## External consumers

Downstream projects that consume published `@effected` packages but stay in their own repos, per the libraries-only scope in [architecture.md](architecture.md). The consumer-to-package mapping and the five that define the release criterion are in [releases.md](releases.md#the-five-applications):

- rolldown-pnpm-config
- vitest-agent
- rspress-plugin-api-extractor
- soda3js/tools (via `@soda3js/config`)
- silk-update-action (savvy-web)
- savvy-web/systems (via `@savvy-web/silk-effects`' DepsRegen)
- the `@savvy-web/*` silk system

The github-split program added five more, surveyed but never modified during it: silk-release-action, silk-sync-action, silk-router-action, silk-runtime-action and spencerbeggs/claude-code-marketplace-manager. One migration map per repo, with what each replaces and where that code lives today, is in [consumers/](consumers/README.md).
