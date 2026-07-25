---
status: current
module: effected
category: migration
created: 2026-07-25
updated: 2026-07-25
completeness: 90
related:
  - README.md
  - ../../plans/2026-07-25-github-split-master.md
  - ../../plans/2026-07-25-github-split-decisions-log.md
  - ../packages/commands.md
  - ../packages/templates.md
  - ../packages/workspaces.md
  - ../packages/markdown.md
  - ../packages/config-file.md
  - ../packages/github.md
  - ../plugin.md
---

# savvy-web/systems — migration map

## Overview

`/Users/spencer/workspaces/savvy-web/systems` is the source monorepo: it owns `@savvy-web/github-action-effects` (the package the program replaces wholesale), `@savvy-web/silk-effects` (whose mechanism half moves up into the kit), and the `github-actions` Claude Code plugin (superseded by effected-plugin skills in Phase 7).

**Blast radius.** Three distinct removals, with very different shapes:

- **`packages/github-action-effects@3.1.0`** — 40 service files, 87 layer files, nine runtime dependencies. **No other package inside systems depends on it.** It is a standalone published library with only external consumers, so deleting it costs systems nothing internally; the cost is entirely in the six downstream repos.
- **`packages/silk-effects`** — seven modules move up. Unlike the above, these have **real internal consumers**: `packages/cli`, `packages/mcp` and `packages/silk` all depend on silk-effects at `workspace:*` and import the moving symbols directly. `packages/silk` additionally *re-exports* several of them, so its public surface is a pass-through that any removal has to account for.
- **`plugins/github-actions@3.2.3`** — 12 skills, one agent, a session-start hook and an MCP server launcher. Replaced, not moved: the effected plugin gains rewritten skills against the new API surfaces.

Systems is already a heavy kit consumer — seven of its packages declare `@effected/*` dependencies — which is the argument that the upstream direction is the natural one.

## `@savvy-web/silk-effects` — modules moving up

| Old construct | Where it lives | Internal consumers (src) | Effected replacement | Status |
| --- | --- | --- | --- | --- |
| `ToolDiscovery` (`resolve`, `require`, `isAvailable`, `clearCache`) | `packages/silk-effects/src/services/ToolDiscovery.ts` | `packages/mcp/src/runtime.ts`; `packages/cli/src/cli/index.ts`, `src/commands/check.ts`, `src/commands/lint/check.ts`; `packages/silk-effects/src/{index,lint/index}.ts`, `src/turbo/services/TurboInspector.ts` | `ToolDiscovery` + `Tool` + `VersionProbe`, with `LocalExec` as the inverted contract implemented by `Workspaces.localExecLayer` (`@effected/commands`) | shipped |
| `ManagedSection` (7 `Fn.dual` members: `read`, `isManaged`, `write`, `sync`, `syncMany`, `check`, `remove`) | `packages/silk-effects/src/services/ManagedSection.ts` | 7 `packages/cli/src/**` files; `packages/silk-effects/src/{index,lint/cli/sections,schemas/SavvySections}.ts` | `ManagedSection` service + the pure `SectionDocument` core, `SectionDialect`, `CommentStyle` (`@effected/templates`) | shipped |
| `TagStrategy` (`determine`, `formatTag`) | `packages/silk-effects/src/services/TagStrategy.ts` | `packages/mcp/src/runtime.ts`; `packages/silk-effects/src/{index,schemas/*,errors/TagFormatError,services/SilkWorkspaceAnalyzer}.ts` | `ReleaseTag` + `TrackingTag` + `classifyTag` — **pure value classes, not a service**; `TagFormatError` disappears (`@effected/workspaces`) | shipped |
| `VersioningStrategy` (`detect`) | `packages/silk-effects/src/services/VersioningStrategy.ts` | `packages/mcp/src/runtime.ts`; `packages/cli/src/cli/index.ts`, `src/commands/commit/check.ts`; `packages/silk-effects/src/{index,schemas/*,errors/VersioningDetectionError,services/SilkWorkspaceAnalyzer}.ts` | `VersioningStrategy.classify` (pure, total) + `.detect(options?)` over `WorkspaceDiscovery \| PublishabilityDetector`; `fixedGroups` becomes a plain argument (`@effected/workspaces`) | shipped |
| `MarkdownService` (`parse`, `stringify`) | `packages/silk-effects/src/changesets/services/markdown.ts` | `packages/silk-effects/src/changesets/{errors,index,changelog/index,utils/remark-pipeline,api/changelog,services/changelog}.ts` | **deleted downstream; changesets engine stays on mdast** — round-1 correction: `parse`/`stringify` had zero real call sites (pure indirection, removed), and the changesets engine (8 remark plugins, 5 markdownlint rules) is written against real mdast, which reaches the kit only through the `Mdast.fromMdast` bridge — adopting it would mean a rewrite or two conversions plus a decode per in-process call | closed |
| `ConfigDiscovery` (`find`, `findAll`; `lib/configs/{name}` then `{cwd}/{name}`) | `packages/silk-effects/src/services/ConfigDiscovery.ts` | `packages/cli/src/cli/index.ts`, `src/commands/lint/check.ts`; `packages/silk/src/lint/index.ts`; `packages/silk-effects/src/{index,commitlint/index,schemas/ConfigDiscoverySchemas,errors/ConfigNotFoundError}.ts` | **not absorbed** — the two-tier search is one tool's layout, expressible as two `ConfigResolver.staticDir` entries (`@effected/config-file`) | stays local |
| `GitHubService.getInfo({commit, repo})` | `packages/silk-effects/src/changesets/services/github.ts` | `packages/silk-effects/src/changesets/{errors,index,changelog/*,schemas/github,api/changelog,services/changelog,vendor/github-info}.ts` | `GitHubCommit.get(ref)` (`@effected/github`) | Phase 2 pending |

## `@savvy-web/github-action-effects` — replaced wholesale

| Fact | Value |
| --- | --- |
| Path | `packages/github-action-effects` |
| Version | `3.1.0` (`"private": true`) |
| Source | 40 files under `src/services`, 87 under `src/layers` (incl. an 8-file `internal/`) |
| Runtime deps | `@azure/storage-blob`, `@cyclonedx/cyclonedx-library`, `@octokit/auth-app`, `@octokit/rest`, `@sigstore/bundle`, `@sigstore/sign`, `@effected/jsonc`, `@effected/semver`, `@effected/yaml` |
| Peers | `effect`, `@effect/platform-node` (`catalog:effectPeers`) |
| Internal consumers | **none** |

Destinations are the program's package topology: the Actions runtime → `@effected/github-actions`, the GitHub API surface → `@effected/github`, `CommandRunner` → `@effected/commands`, `Sbom`/`SigstoreSigner` → `@effected/sbom`, `NpmRegistry`/`PackagePublish` → `@effected/npm`, `ConfigLoader` → `@effected/config-file`. `@octokit/rest` and `@octokit/auth-app` are both **dropped**, not ported — ~1.9MB out of every consumer tree.

Two dependency notes worth carrying: `@effected/jsonc`, `@effected/semver` and `@effected/yaml` are already here, so the octokit/CycloneDX/Sigstore/Azure quartet is the whole of what the split redistributes; and the per-package split is what makes silk-sync-action's CycloneDX bundler `ignore` structurally impossible.

## `plugins/github-actions` — replaced by effected-plugin skills (Phase 7)

| Fact | Value |
| --- | --- |
| Path | `plugins/github-actions`, version `3.2.3` |
| Skills (12) | `action-engineering`, `builder-config`, `checks-and-reports`, `errors-and-state`, `github-api`, `github-app-auth`, `inputs`, `logging`, `outputs-and-schemas`, `runtime-and-layers`, `scaffolding`, `testing-actions` |
| Agents (1) | `agents/action-engineer.md` |
| Hooks | `hooks/hooks.json` → `session-start` → `hooks/session-start/orientation.sh`; shared `hooks/lib/{hook-debug,hook-output}.sh` |
| Other | `bin/start-mcp.sh` (launches the `savvy-mcp` server declared in `plugin.json`), `tests/*.bats` |

Per master-plan Phase 7 this is a **reference for coverage and skill shape only** — its content documents the old API and is rewritten against `@effected/github` / `@effected/github-actions` / `@effected/sbom` / `@effected/npm` inside this repo's `plugin/`. The root `.claude-plugin/marketplace.json` pins both systems plugins by git-subdir SHA and names `@savvy-web/github-action-effects` in the descriptions, so it needs updating as part of the replacement.

## `@effected/*` already in use

| Package | `@effected/*` deps |
| --- | --- |
| `packages/silk-effects` | `git`, `glob`, `jsonc`, `package-json`, `walker`, `workspaces`, `yaml` |
| `packages/cli` | `git`, `jsonc`, `workspaces`, `yaml` |
| `packages/tsdown-plugins` | `npm`, `package-json`, `tsconfig-json`, `workspaces` |
| `packages/mcp` | `workspaces` |
| `packages/templates` | `package-json`, `yaml` |
| `packages/github-action-builder` | `yaml` |
| `packages/github-action-effects` | `jsonc`, `semver`, `yaml` |

## Stays local

Confirmed on disk, so the boundary is accurate rather than aspirational.

- **`packages/silk-effects/src/services/`** — `BiomeSchemaSync.ts`, `ChangesetConfig.ts`, `ChangesetConfigReader.ts`, `SilkPublishability.ts`, `SilkWorkspaceAnalyzer.ts`, plus `ConfigDiscovery.ts` (see above).
- **`turbo/`** — `digest.ts`, `errors.ts`, `index.ts`, `schemas/`, `services/TurboInspector.ts`.
- **`repos/`** — `constants.ts`, `errors.ts`, `index.ts`, `schemas/`, `services/`.
- **The changesets engine** — everything under `changesets/` except the two absorbed service files: `api/`, `categories/`, `changelog/`, `markdownlint/` (5 rules), `remark/` (8 plugins, 5 rules), `presets.ts`, `schemas/`, `services/{branch-analyzer,changelog,config-inspector,deps-regen,maintenance-reason,release-planner}.ts`, `utils/`, `vendor/`.
- **`commitlint/`, `lint/`, `errors/` (13 files), `schemas/` (13 files), `utils/`** and the root `index.ts`.
- **`packages/templates`** — Savvy's actual template content. Spec §9's "mechanism here, content downstream" division: the package already exists and already consumes `@effected/package-json` and `@effected/yaml`.
- **`packages/bundler`, `e2e/`, `website/`** — outside the blast radius.

## Open questions

1. **`packages/silk` is a re-export surface, not just an importer.** `packages/silk/src/{lint,commitlint,changesets}/*` re-export several absorbed symbols (notably `ConfigDiscovery` via `lint/index.ts`, and the changesets `markdown`/`github` services transitively). Removing a module from silk-effects breaks `packages/silk`'s public contract, not only its internal calls. Nothing in the program plans that shim. *Round-1 outcome: did not bite — silk never re-exported any moved symbol. It did need `@effected/templates` as a direct dependency (its inferred public surface names kit types), caught only by a dist-level typecheck, not per-package src `tsc`.*
2. **`TagStrategy` and `VersioningStrategy` cannot be extracted independently.** `SilkWorkspaceAnalyzer` — which **stays** — composes both, and `TagStrategy.ts` names `VersioningStrategy` in its TSDoc example. Extracting one leaves the staying service broken; they move together or not at all.
3. **`ManagedSection` has schema-level coupling.** `packages/silk-effects/src/schemas/SavvySections.ts` imports `ManagedSection` types directly, so the extraction has to check for circular re-exports rather than assuming a clean service boundary. *Round-1 outcome: closed — the circularity did not exist (SavvySections only ever imported section value types, never the service). The real migration hazard was SectionId key case-normalization; see the README's migration warnings.*
4. **`packages/templates` already exists.** Spec §9 left it open whether Savvy ships a new package or keeps content in silk-effects; it is already a package with kit dependencies. The templates decisions-log item 5 says the choice does not affect the kit's design, which holds — but the map should record that the downstream half is done.
5. **`plugins/silk` was not surveyed.** The root marketplace registers two plugins; only `github-actions` is in Phase 7 scope. If silk-effects skills also migrate as their modules move, `plugins/silk` needs its own pass.
6. **`website/lib/models/github-action-effects/`** holds a checked-in API Extractor model for the package being deleted. It goes stale on removal.
