---
status: current
module: effected
category: architecture
created: 2026-07-12
updated: 2026-07-22
last-synced: 2026-07-22
completeness: 88
related:
  - releases.md
  - package-inventory.md
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - packages/runtimes.md
  - packages/app.md
  - packages/tsconfig-json.md
  - packages/git.md
  - packages/spdx.md
  - packages/package-json.md
  - packages/markdown.md
---

# Roadmap

## Overview

The migration program is complete and the `0.1.0` gate is met: the kit ships nineteen publishable packages (eighteen libraries plus the [companion](effect-standards.md#companion-packages-published-but-not-a-library)) as an explicit pre-release. This doc records what comes after `0.1.0`. The decisions below are settled, recorded with their reasoning so they are not re-litigated; each new package gets its own spec → plan → implement cycle per the [migration playbook](migration-playbook.md). [releases.md](releases.md)'s gate table and [package-inventory.md](package-inventory.md) stay authoritative for the shipped set.

The nineteenth package, **`@effected/spdx`** (pure, invention), landed after the gate was first declared and joined it: it vendors the SPDX license and exception datasets as pure schemas so [`@effected/package-json`](packages/package-json.md) can delegate its `license` validation and drop `spdx-expression-parse`, the kit's last foreign runtime dependency. That delegation retiered package-json from integrated to boundary. It followed the design-doc-first playbook cycle; [packages/spdx.md](packages/spdx.md) is authoritative.

The consumer ports — including `rspress-plugin-api-extractor`, the one representative consumer once chosen to prove the gate before publishing — run as post-`0.1.0` dogfooding against real published packages, with the [pre-release framing](releases.md#versioning) as the safety valve. Publishing early gets consumers onto real `@effected/*` packages sooner and surfaces integration problems as they actually arise.

## Application-tier abstractions to evaluate

Core's `effect/unstable/workflow` (durable workflows: `Workflow`, `Activity`, `DurableClock`/`DurableDeferred`/`DurableQueue`, `WorkflowEngine`) is a strong abstraction for **applications** — long-running, resumable, multi-step operations with retry semantics. It is not kit-library surface, but the consumer ports should evaluate it where the shape fits: DepsRegen's plan/execute phases, silk-update-action's multi-step update runs and any future release automation are the natural candidates. Evidence-driven like everything here: adopt it where a consumer's port genuinely has durable multi-step state, never speculatively.

## Post-0.1.0 packages

In priority order.

### `@effected/commands`

A generalization of silk-effects' ToolDiscovery service: resolve CLI tools globally on PATH vs locally via the detected package manager's exec (pnpm/npm/yarn/bun), configurable version extraction, source constraints and version-mismatch policies, plus structured command running over core's `effect/unstable/process`. This pattern has been reinvented repeatedly across Spencer's repos; it earns a package. Peers on `@effected/workspaces` for package-manager detection and workspace-root resolution. Port note: the v3 code calls `process.cwd()` directly; the v4 design must parameterize that.

This is not a gate package, and it owns no platform seam. Core declares `ChildProcessSpawner`, `@effect/platform-node`'s `NodeServices.layer` provides it, and requiring a core-declared service in `R` costs a consumer nothing ([R3](effect-standards.md#dependency-policy), the walker/xdg `FileSystem` pattern) — so `@effected/git` requires the spawner in `R` directly and nothing on the gate needs this package. The contract-inversion option (commands owns the tool-resolution contract, workspaces implements it) remains available as a design choice but is not forced.

### `@effected/templates`

v1 scope is **managed sections only**, ported from silk-effects' ManagedSection: delimited BEGIN/END managed-section blocks inside user-editable files, with a parameterized marker phrase and comment-style set, read/isManaged/write/sync/check/remove, and the `syncMany` document-reconciliation algorithm (splitting a document into spans and section placeholders, reassigning declared blocks to existing slots in document order and placing missing blocks relative to sibling anchors). Whole-file templating joins later only when a v4 consumer demands a concrete shape.

### The config companion

A silk-pattern companion package — the pattern `@vitest-agent/plugin` and `@savvy-web/silk` follow: ship config JSON files and peer-depend on the mcp/cli tools, so consumers' Claude Code plugins and tooling stay on the same versions. It ships preconfigured tsconfigs, including the tsgo LSP tsconfig once [the spike](#the-tsgo-lsp-track) proves out.

Naming: recommended `@effected/plugin`. `@effected/config` is rejected because it reads as a sibling of `@effected/config-file` and would confuse every import list. Companion category, no tier, like `pnpm-plugin-effect` ([effect-standards.md](effect-standards.md#companion-packages-published-but-not-a-library)).

### `@effected/markdown`

`rspress-plugin-api-extractor` already parses and emits markdown via `mdast-util-from-markdown`, `mdast-util-to-hast` and `gray-matter`, so a low-level markdown package has a real identified consumer rather than a speculative one. It is not a release gate: the plugin can keep its `mdast` dependencies and swap everything else.

The package now exists on `feat/markdown` with implementation phases P1-P5 complete (2026-07-19): CommonMark plus the gfm dialect with full conformance, frontmatter with the codec modules and the schema resolver, edit/format with canonical stringify, and the mdast projection, visitor and navigation surface — 3516 tests. P6 (docs and adoption, the rspress-plugin-api-extractor swap) remains before the package's story closes; details in [packages/markdown.md](packages/markdown.md).

### `@effected/vfs`

Out of the ts-vfs work: the TypeScript-specific part it exercised (a `Vfs` keyed by `node_modules/`-prefixed paths, merge/prefix helpers, an environment seam) is a flavor of a generic virtual filesystem rather than the whole of it. Evidence-gated like everything here — build it only when a **second** VFS consumer materializes beyond the TypeScript one, never speculatively.

## Kit workstreams from the markdown sprint

Recorded 2026-07-19 as findings from the `@effected/markdown` implementation sprint (P1-P5 on `feat/markdown`, see [packages/markdown.md](packages/markdown.md)), in execution order.

1. **Effect beta nosebleed policy** — advance the effect catalogs to the newest beta (currently `.99`) promptly after each phase of major work: the effect team publishes caret peer ranges, so live applications already resolve the newest beta and the kit should test against what consumers actually run. The advance is the user-run `pnpm pnpm:up`/`pnpm pnpm:export` flow with the `.repos/effect-smol` re-pin in the same commit and a full-kit verification after.
2. **`Jsonc.stringify` and frontmatter completion** — add a canonical stringify to `@effected/jsonc` for surface parity with yaml and toml (design-doc pass on [packages/jsonc.md](packages/jsonc.md) first), then complete the markdown frontmatter story: replace the `JSON.stringify` fallback in the round-trip property and lift `MarkdownFormat.modify`'s frontmatter refusal so frontmatter updates flow through the edit layer.
3. **Edit-parity hardening** — backport toml's `applyAll` overlap guard to jsonc and yaml, standardize the format range-filter posture (three postures are currently documented across the four format packages) and promote the parity contract in [effect-standards.md](effect-standards.md) from shape-identical to behavior-identical.
4. **TOML 1.1 investigation** — a design-doc note in [packages/toml.md](packages/toml.md) enumerating the 1.1 delta set (draft spec — verify release status first) against the engine, shaped as a dialect/version option per the markdown dialect-registry pattern; implement when 1.1 tags a release or behind a draft flag on application demand.

## The tsgo LSP track

Parallel and experimental. A time-boxed spike **in this repo** proving end-to-end: patched `typescript` plus the [`@effect/tsgo`](https://github.com/Effect-TS/tsgo) language server giving agents real-time feedback while they work, with the patch applied via pnpm patching. Only after the spike proves out does packaging happen: the [config companion](#the-config-companion) carries the patch and a `tsconfig/lsp.json`, and a plugin skill teaches agents the setup. Failure is cheap by design — if the spike fails, or TypeScript 7.1 ships an official API story first, the loss is a spike, not a package.

## Consumer ports

External repos. These are **pull, not push** — they proceed whenever their inputs exist and never block kit packages. All run against real published packages.

- **rspress-plugin-api-extractor** — a full application port, not a dependency swap: the plugin's v3 `*-effect` dependencies cannot coexist with the v4 kit. Twoslash type-checking keeps `typescript@6` as a direct dependency, the sanctioned island until the TypeScript 7.1 JS API exists. Consumes `ts-vfs` from its own repo.
- **@savvy-web/bundler** (savvy-web/systems) — its TS usage is syntactic parser plus config API only, no type checker. `tsconfig-json` replaces `meta/tsconfig-resolver.ts`; the `dts/` AST walkers wrap plain `typescript` calls in Effect.
- **vitest-agent**, **@soda3js/config** and the **runtime-resolver CLI re-ship**.
- **silk-update-action** and **savvy-web/systems** (DepsRegen, plus the `savvy` CLI and MCP adapters over it) — the two consumers that scoped workspaces' point-in-time functionality; they migrate off `workspaces-effect`.

## The TypeScript 5→6→7 posture

TypeScript 7 (the Go rewrite) ships tsc but no JS-compatible API until 7.1, whose timing is unknown. The rule that threads through everything: **`@effected/*` packages never import `typescript`**. `tsconfig-json` owns the version-coupled enum mappings as data. Direct TS-API usage is confined to external consumers — the api-extractor plugin carries `typescript@6` directly for Twoslash — until the TS 7.1 JS API exists, at which point the island is revisited. The bundler left its TypeScript 6 island at 2.0: it now peers on `typescript@^7`, satisfied by the workspace's `catalog:silk` pin (TypeScript 7.0.2), which every package typechecks under. Because `@effected/ts-vfs` (the one package that kept the compiler behind optional peers) has left the kit, the posture holds at the package-set level, not only behind optional peers.

## Decided against

### `@effected/errors`

A shared cross-package errors package was rejected, for four reasons:

1. The kit already has a shared error vocabulary — `effect` core's `PlatformError`, `SqlError` and Schema parse issues are the errors that genuinely cross every boundary.
2. A central errors package is a barrel with different syntax — the same coupling argument that forbids the codec namespace object — and it inverts ownership: each package's error model is part of its designed API surface, and centralizing it makes every error change a cross-package release event.
3. Effect's error channel composes unions structurally — tagged errors discriminate on `_tag`, `catchTag` narrows, and `Effect<A, WalkerError | ConfigParseError>` flows across package boundaries with no nominal coordination.
4. The genuine cross-boundary case already has a house pattern, `@effected/npm`: when an error must cross a boundary it travels with the contract it belongs to, into a small package named for the contract, never into a generic errors package.

Convention drift — error shape, `_tag` naming, structure-preserving fields — is already legislated in [effect-standards.md](effect-standards.md).
