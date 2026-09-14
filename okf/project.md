---
type: Project
title: effected
description: What this project is, its boundaries, and its non-goals.
status: stable
tags:
  - architecture
generated:
  by: "claude-code/opus-5"
  at: 2026-09-14T04:45:45Z
  body_sha256: 3462cf86e5a896952ba93cb0fe99993ab5647229786a211afb274f9c980831cc
---

# effected

## Purpose

effected (GitHub `spencerbeggs/effected`, npm org `@effected`) is a pnpm monorepo building an **Effect v4 app kit**: a coherent set of libraries designed v4-first rather than a grab-bag of utilities that happen to share a repo. It replaces per-repo development of a family of predecessor `*-effect` libraries that suffered cross-repo release loops and dependency-interaction bugs surfacing only after publishing. The unit of design is the kit, not the package — packages are carved along the seams real applications press on, and a capability with no named consumer is not built. Scope is closed by five consuming applications (below), not by how much surface an ecosystem could have. All `@effected/*` packages target Effect v4, currently prerelease and pinned via the `effect` pnpm catalog, tracking prereleases (the release line renamed `-beta` to `-rc` at `4.0.0-rc.108`) until v4 stabilizes. Everything published is `0.x` and unstable; `1.0.0` waits for Effect v4 GA. Releases are changeset-driven: CI builds the changesets present on a branch and releases the packages they name, whether that is the whole kit behind a catalog advance or a single package on a patch — both are ordinary outcomes of the same mechanism, not different processes.

## Design posture

The developer-experience exemplar is the [`semver`](modules/semver.md) package, for its class-based API: static and instance methods on domain classes, no floating functions. In Effect v4 the domain-model class and the schema are the same artifact (`Schema.Class`), so this class-based DX is the ecosystem norm the kit follows, not a house deviation from it.

## Boundaries

The repository holds **libraries and their companions**. Standalone tools and applications built on these libraries stay in their own repos and consume published `@effected` packages: a repository with an entry point a user runs, rather than an API a program imports, does not belong here. The one admitted exception is a **bin-only companion** that fronts exactly one library here and releases as a fixed pair with it (`schemastore-cli` over `schemastore`): it is the library's own command-line surface, not an application, and it carries no library tier — see [companion package](glossary/companion-package.md). Package membership is the `packages/` directory listing.

| Package | Tier | Provenance |
| --- | --- | --- |
| `semver` | pure | port of `semver-effect`; the DX exemplar |
| `jsonc` | pure | port of `jsonc-effect` |
| `yaml` | pure | port of `yaml-effect`; the largest package in the repo |
| `package-json` | boundary | port of `package-json-effect`; SPDX validity delegated to `spdx` |
| `npm` | boundary (was pure) | extraction from `package-json`; resolver contracts plus registry/publish services |
| `config-file` | boundary | port of `config-file-effect`; the four config codecs as free-standing named exports |
| `walker` | boundary | extraction from `config-file`; upward path traversal |
| `glob` | pure | invention; a vendored minimatch dialect as pure string→predicate schemas |
| `toml` | pure | invention; a from-scratch, full-parity TOML engine |
| `lockfiles` | pure | extraction from `workspaces`; bun/npm/pnpm/yarn parsers |
| `store` | integrated | extraction from `xdg`; migrated SQLite `Store` and TTL `Cache` |
| `xdg` | boundary | port of `xdg-effect`; does not depend on `store` |
| `workspaces` | integrated | port of `workspaces-effect`; discovery, dependency graph, catalogs, change detection |
| `runtimes` | boundary | port of `runtime-resolver`'s library half |
| `tsconfig-json` | boundary | invention; zero `typescript` imports |
| `git` | boundary | invention; typed git introspection over core's `ChildProcessSpawner` |
| `spdx` | pure | invention; vendored SPDX license expressions as pure schemas |
| `app` | integrated | invention; thin composition over `xdg` + `config-file` + `store` |
| `cli` | boundary | invention; the CLI boundary (logger, failure reporting, issue rendering) over `effect/unstable/cli` |
| `markdown` | pure | invention; CommonMark + GFM as pure schemas |
| `commands` | boundary | part-port of `@savvy-web/silk-effects`' `ToolDiscovery` plus invention |
| `templates` | boundary | port of `@savvy-web/silk-effects`' `ManagedSection` |
| `memfs` | pure | invention; a virtual POSIX volume behind core's `FileSystem` key — carries **no `@effected/*` edge, ever** |
| `github` | integrated | port-with-redesign of `@savvy-web/github-action-effects`'s GitHub half |
| `github-references` | pure | extraction from `github`; the issue-reference grammar as pure functions |
| `github-actions` | integrated | port-with-redesign of the same package's Actions half |
| `sbom` | integrated | port-with-redesign of the same package's `Attest` knot |
| `schemastore` | integrated (was boundary) | invention; SchemaStore-shaped JSON Schema documents from Effect Schema sources |
| `schemastore-cli` | companion — no tier | invention; the `schemastore` bin over `@effected/schemastore`: build/check a `schemastore.config.ts` under a per-schema published flag and a drift policy |
| `schema-org` | pure | invention; schema.org vocabulary as Effect Schema classes |
| `jsonl` | boundary | invention; append-only schema-validated JSONL journals |
| `pnpm-plugin-effect` | companion — no tier | invention; publishes the Effect catalogs the kit pins against |

### Consumers

The kit's scope is closed by the applications that consume it, surveyed read-only from outside this repository.

| Consumer | Register entry |
| --- | --- |
| savvy-web/silk-release-action | [silk-release-action](consumers/silk-release-action.md) |
| savvy-web/silk-update-action | [silk-update-action](consumers/silk-update-action.md) |
| savvy-web/silk-runtime-action | [silk-runtime-action](consumers/silk-runtime-action.md) |
| savvy-web/silk-sync-action | [silk-sync-action](consumers/silk-sync-action.md) |
| savvy-web/silk-router-action | [silk-router-action](consumers/silk-router-action.md) |
| spencerbeggs/claude-code-marketplace-manager | [claude-code-marketplace-manager](consumers/claude-code-marketplace-manager.md) |
| savvy-web/systems | [systems](consumers/systems.md) |
| spencerbeggs/reposets | [reposets](consumers/reposets.md) |
| spencerbeggs/tsdoctor | [tsdoctor](consumers/tsdoctor.md) |

Two named applications resolved the "library wearing app clothing" question differently rather than joining the kit outright: `type-registry-effect` stays entirely outside, in its own repo, because it carries `typescript` / `@typescript/vfs` peers the kit refuses; `runtime-resolver`'s library half ships from the kit as `runtimes`, while its CLI ships from the external `runtime-resolver` repo against the published package, so the library's consumers never install `@effect/platform-node`. Further external consumers — `rolldown-pnpm-config`, `vitest-agent`, `rspress-plugin-api-extractor`, and `soda3js/tools` via `@soda3js/config` — take published packages without a register entry of their own in this bundle.

The repository's monorepo tooling and layout are documented in [the workspace module](modules/workspace.md); the two agent plugins, the probe workspace and the docs site each have their own Module: [claude-code-plugin](modules/claude-code-plugin.md), [copilot-plugin](modules/copilot-plugin.md), [scratchpad](modules/scratchpad.md), [website](modules/website.md).

## Non-goals / out of scope

- **Applications.** Anything with a user-run entry point rather than an importable API stays in its own repo, even when it started life here or shares packages with the kit.
- **`@effected/json-schema`.** Off the roadmap entirely: its core value is superseded by Effect v4's `Schema.toJsonSchemaDocument`, and the one internal dependency on it (from `xdg`) was a dead facade that has been cut. It would be revisited only if a consuming application appeared.
- **`ts-vfs`.** Lives in the external `type-registry-effect` repo; carries the `typescript` / `@typescript/vfs` peers the kit's "no `@effected/*` package imports `typescript`" posture excludes.
- **The `runtime-resolver` binary.** Ships from the external `runtime-resolver` repo against the published `runtimes` package, so the library's own consumers never need `@effect/platform-node`.
- **Importing `typescript`.** No `@effected/*` package imports the `typescript` package; version-coupled facts it would otherwise need (such as `tsconfig-json`'s enum mappings) are carried as data instead.
