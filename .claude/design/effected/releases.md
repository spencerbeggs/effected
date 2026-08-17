---
status: current
module: effected
category: architecture
created: 2026-07-09
updated: 2026-08-17
last-synced: 2026-08-17
completeness: 88
related:
  - architecture.md
  - packages/cli.md
  - consumers/reposets.md
  - package-inventory.md
  - effect-standards.md
  - roadmap.md
  - packages/toml.md
  - packages/package-json.md
  - packages/spdx.md
  - packages/store.md
  - packages/lockfiles.md
  - packages/xdg.md
  - packages/workspaces.md
  - packages/runtimes.md
  - packages/app.md
  - packages/tsconfig-json.md
  - packages/git.md
  - packages/npm.md
  - packages/commands.md
  - packages/github.md
  - packages/github-references.md
  - packages/memfs.md
  - packages/jsonl.md
  - consumers/README.md
---

# Release criteria

## Overview

How the kit releases, and what closed the question of which packages had to exist before it could release at all.

The kit did not release package-by-package on its way in: the whole gate set published together at `0.1.0` against one `effect` beta, as an explicit **pre-release**. Nothing here claims stability, and consumer ports proceed against real published packages rather than being gated behind a synthetic proof. `1.0.0` waits for Effect v4 GA.

**Releases are changeset-driven, and the release set is an output of that mechanism rather than a policy choice.** CI builds the appropriate changesets and releases the packages they name — the whole kit when a catalog advance touches everything, a single package when a patch is the only thing pending. Both shapes are ordinary: the 27-package beta.107 wave and solo patches like `workspaces@0.11.1` are the same mechanism producing different sets. A package may be released on its own.

In practice new packages have debuted alongside others, because a wave that introduces one usually touches its neighbours too — but that is an observation about how the changesets have fallen, not a rule the process enforces.

## Versioning

Version and stability are separate axes.

- **Version.** Every package stays below `1.0.0` until Effect `4.0.0` GA, pinning a single Effect v4 prerelease throughout development. Graduation to `1.0.0` follows Effect `4.0.0`. Until then the `effect` peer range names the prerelease pinned in the `effect` catalog in `pnpm-workspace.yaml`, and a catalog bump is a coordinated change across the whole kit — one changeset per package, one wave.
- **Stability.** A per-package `stable | unstable` axis independent of the version number. **Every package is `unstable`.** Consumers pin exact versions, so an accidental break surfaces in their type-checking rather than silently through a range — the pre-release contract made mechanical.

**A branch build reports the *previous* release's version, and that collides with the registry.** Changesets bump at release, so `dist/**` on an unreleased branch carries the version of the last release while the code contains the unreleased work — and the registry is serving that same number. A consumer linked against a local build therefore sees a version identical to the published one, for different code. A dogfood consumer nearly pinned `^0.9.1` on that basis and would have resolved to code they had never run (`@spencerbeggs/reposets`, 2026-08-14; they caught it and asked for the published numbers rather than inferring them).

The rule that follows: **a linked consumer must not derive its pin from the linked build's version.** Take the version from the release — the `release` mail, or `npm view <pkg> version` — never from the artifact you are linked against. The upstream owes those numbers explicitly at exit for the same reason.

**Below `1.0.0`, breaking changes ride minors, and the exact-pin discipline is what makes them survivable.** Read a minor here as "may break" and consult the package's changeset before advancing a pin. [`@effected/schemastore`](packages/schemastore.md) is the worked example: one minor carried a changed `SchemaFile.write` return type, a narrowed `SchemaVersion` grammar and a tier flip to integrated. That is the contract working as designed, not an exception to it.

`@effected/pnpm-plugin-effect` publishes with the kit, not apart from it. It is the kit's [companion](effect-standards.md#companion-packages-published-but-not-a-library) — published and installable but not a library, exposing no API and carrying no tier. Its reason to exist is consumer-facing: it carries the two Effect catalogs this repo pins against, so a consumer can hold their own `effect` versions and peer floors at the values the kit was built and tested against. **Installing it is optional for the consumer; shipping it is not optional for the release.** Do not read `"private": true` in a source manifest as evidence about release intent — every source manifest here is private, and the bundler's `publishConfig` transform emits the publishable manifest at build time ([architecture.md](architecture.md)).

## The five applications

The release criterion is "the kit can replace the business logic of these five." They split into two kinds.

**Libraries wearing app clothing** — each was a candidate to absorb, and each resolved differently:

- `type-registry-effect` — stays **outside the kit**, in its own repo. It belongs to the `rspress-plugin-api-extractor` docs stack and carries the `typescript` / `@typescript/vfs` peers, so keeping it out preserves the kit's "no `@effected/*` package imports `typescript`" posture. Its consumer takes it from source.
- `runtime-resolver` — the library ships from the kit as `@effected/runtimes` (boundary tier); the CLI ships from the external `runtime-resolver` repo against the published package, so the library's consumers never install `@effect/platform-node`. See [packages/runtimes.md](packages/runtimes.md).

**External consumers** — stay in their own repos, per the libraries-only scope in [architecture.md](architecture.md). Each must be able to swap its `*-effect` dependencies for `@effected/*`:

- `rspress-plugin-api-extractor` — the published package is `plugin/`, not the repo root. It consumes `semver` and `store` from the kit, and its VFS layer from its own source repo.
- `vitest-agent` — consumes `workspaces`, `config-file`, `xdg` and `store`, and transitively `walker` and `lockfiles`.
- `soda3js/tools` — via `@soda3js/config`, an Effect package that loads and writes a TOML config file. It consumes `config-file` and `toml`, needing **only** TOML. `TomlCodec` arrives inside `@effected/config-file`, so this consumer carries unexecuted dependency edges on `@effected/jsonc` and `@effected/yaml`. It provably pays nothing for them — an explicitly-composed codec is tree-shaken when unreferenced and, unbundled, ESM never loads a module nobody imports ([packages/config-file.md](packages/config-file.md#the-load-bearing-constraint-free-standing-named-exports-never-a-namespace-object)). This is the consumer that would pay if either fact were ever falsified.
- `silk-update-action` (savvy-web) — consumes `workspaces` (root discovery, package-manager detection, the lockfile reader) and `lockfiles` (per-importer declared dependencies for before/after lockfile diffing).
- `savvy-web/systems` — via `@savvy-web/silk-effects`' DepsRegen engine: consumes `workspaces`' snapshot service (git at-ref and worktree snapshots), the opt-in config-dependency hook replay, and `@effected/git` directly for the git operations its tooling currently hand-rolls — DepsRegen's merge-base/ls-tree reads, the cli/mcp/silk-effects introspection wave and the repos domain's submodule mutations ([issue #82](https://github.com/spencerbeggs/effected/issues/82)).

## The gate

The gate is the union of what those consumers need, and it is met. The gate set was **nineteen publishable packages**: eighteen libraries plus the `pnpm-plugin-effect` companion. It is a closed historical set — the table below is the record of why each one had to exist before the kit could publish at all, not a filter on anything now. The kit is thirty publishable packages today ([package-inventory.md](package-inventory.md)); how the other eleven arrived is [below](#joining-the-release-stream-after-the-gate).

| Package | Tier | Why it is on the gate |
| --- | --- | --- |
| `@effected/semver` | pure | `rspress-plugin-api-extractor`; the DX exemplar |
| `@effected/jsonc` | pure | `config-file`'s JSONC codec; parse/edit/format |
| `@effected/yaml` | pure | `config-file`'s YAML codec |
| `@effected/package-json` | boundary | manifest schemas and file IO for `workspaces`; SPDX validity delegated to `@effected/spdx` |
| `@effected/npm` | boundary | dependency-resolution contracts `workspaces` implements; it was pure until the registry/publish services landed and stays boundary under a [recorded guardrail](packages/npm.md#the-tier-guardrail-and-it-is-enforced) |
| `@effected/config-file` | boundary | `vitest-agent` and `@soda3js/config`; carries the four codecs (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`) |
| `@effected/walker` | boundary | `config-file`, `xdg` and `workspaces` all traverse paths |
| `@effected/glob` | pure | `workspaces` uses it instead of a `minimatch` runtime dep |
| `@effected/toml` | pure | `@soda3js/config`; a full-parity format package |
| `@effected/lockfiles` | pure | `workspaces` and `silk-update-action` read lockfiles |
| `@effected/store` | integrated | SQLite cache + migrated state; `rspress-plugin-api-extractor` and `vitest-agent` both consume it |
| `@effected/xdg` | boundary | `vitest-agent`; zero runtime deps, does not depend on `store` |
| `@effected/workspaces` | integrated | `vitest-agent`, `silk-update-action`, `savvy-web/systems`; implements `@effected/npm`'s resolver contracts |
| `@effected/runtimes` | boundary | the `runtime-resolver` application's library half; takes only `@effected/semver` and core `HttpClient` |
| `@effected/tsconfig-json` | boundary | `rspress-plugin-api-extractor`'s tsconfig path and the `@savvy-web/bundler` port; owns the version-coupled enum mappings as data |
| `@effected/git` | boundary | typed git introspection plus a marked mutating tier over core's `ChildProcessSpawner`; consumers are `workspaces` and `savvy-web/systems` |
| `@effected/spdx` | pure | vendored SPDX license expressions as pure schemas; `package-json` delegates its `license` validation to it, dropping the kit's last foreign runtime dependency |
| `@effected/app` | integrated | the composition layer over `xdg` + `config-file` + `store`; nothing may depend on it |
| `@effected/pnpm-plugin-effect` | companion — no tier | not a library, but on the gate: it hands consumers the `effect` catalogs the kit was built against |

### `@effected/toml` is a full-parity format package

`@effected/toml` is a full-parity sibling to `@effected/jsonc` and `@effected/yaml` — parse, stringify, Schema, lossless CST, edit-in-place, formatter, visitor — on a from-scratch Effect-native engine targeting TOML 1.0.0, with `smol-toml` appearing only as a devDependency test oracle. The gate consumer `@soda3js/config` needs only parse/stringify: the consumer contract defines the minimum the package must satisfy, not its bound. [packages/toml.md](packages/toml.md) is authoritative.

### Joining the release stream after the gate

Eleven packages arrived after the gate: `markdown`, `schemastore`, `jsonl`, `cli`, `memfs`, `github-references`, and the [github-split five](package-inventory.md#the-github-split-packages) — `commands`, `templates`, `github`, `github-actions` and `sbom`. None entered through this document's criterion, because that criterion is the union of what the five applications need and it was met without them.

What scoped them instead:

- The github-split five are scoped by the program's six consumer repos — the five savvy-web action repos plus claude-code-marketplace-manager — all mapped in [consumers/](consumers/README.md), and **all six have since completed the migration onto them**. Only silk-update-action of those is also one of the five applications.
- `markdown`, `schemastore`, `jsonl` and [`cli`](packages/cli.md) were each scoped by a named consumer and built design-doc-first, then published in the next wave whose changesets named them. `cli` came out of the [reposets](consumers/reposets.md) loop — the kit's first consumer that runs at a terminal rather than on a runner — with its doc written and reviewed by that consumer before the port.
- [`memfs`](packages/memfs.md) was scoped by the kit itself: it is the filesystem test double every other package's suite needs, which is why it carries **no `@effected/*` edge, ever**.
- [`github-references`](packages/github-references.md) is the newest and the only one not yet released. It is the kit's first **extraction driven by install weight rather than by design**: a pure grammar left `github` because an octokit-free consumer could not reach it, and `github` keeps a droppable compat re-export so the move is not a breaking change for the consumer that adopted it in its old home.

That is the whole mechanism, and it is deliberately the same one a version bump uses: **gate membership is history, not a filter.** The gate answered "what must exist before the kit publishes at all", and that question is closed.

### Not on the gate

- `@effected/json-schema` — off the roadmap entirely. Its core value is superseded by v4's `Schema.toJsonSchemaDocument`, and `xdg`'s dependency on it was a dead facade that was cut.
