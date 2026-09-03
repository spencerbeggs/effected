---
status: current
module: effected
category: architecture
created: 2026-07-12
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 85
related:
  - consumers/reposets.md
  - releases.md
  - package-inventory.md
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - packages/markdown.md
  - packages/jsonl.md
  - github-action-canon.md
  - consumers/README.md
---

# Roadmap

## Overview

**Open work only.** What the kit has already shipped is in [package-inventory.md](package-inventory.md), and how it releases is in [releases.md](releases.md); both stay authoritative for the shipped set, and nothing here restates them. This document holds the workstreams that are decided but unbuilt, the standing decisions that bind future work, and the things deliberately declined — recorded with their reasoning so they are not re-litigated.

Everything here is **evidence-gated**: a package or capability enters when a named consumer needs it, never speculatively. Each new package still runs the design-doc-first cycle in the [migration playbook](migration-playbook.md).

## Standing decisions

Two decisions taken during the github-split program bind work beyond it, so they live here rather than in a package doc.

- **`@effect/platform-node` is a required peer in exactly one package**, `github-actions`, because a GitHub Action has one platform and pretending otherwise taxes every consumer. The licence is scoped to that overlay and does not generalize to the next Node-shaped package.
- **Contract inversion is the kit's default answer to a tier-dragging edge.** When package A needs behaviour that only package B can implement, A declares the narrow contract and B ships the layer: `@effected/npm` declares the resolver contracts and `@effected/workspaces` implements them; `@effected/commands` declares `LocalExec` and `workspaces` implements that too. The alternative — a direct edge from A to B — propagates B's tier under [R2](effect-standards.md#dependency-policy).

## Open packages

### The config companion

A silk-pattern companion package, following `@vitest-agent/plugin` and `@savvy-web/silk`: ship config JSON files and peer-depend on the mcp/cli tools, so a consumer's Claude Code plugin and tooling stay on the same versions. It ships preconfigured tsconfigs, including the tsgo LSP tsconfig once [the spike](#the-tsgo-lsp-track) proves out.

Naming: recommended `@effected/plugin`. `@effected/config` is rejected because it reads as a sibling of `@effected/config-file` and would confuse every import list. Companion category, no tier, like `pnpm-plugin-effect` ([effect-standards.md](effect-standards.md#companion-packages-published-but-not-a-library)).

### `@effected/vfs`

A `Vfs` keyed by `node_modules/`-prefixed paths, with merge/prefix helpers and an environment seam, is a flavor of a generic virtual filesystem rather than the whole of it. Build it only when a **second** VFS consumer materializes beyond the TypeScript one that motivated the shape, never speculatively.

## Open workstreams

### `jsonl`: per-scope current state and lifecycle

[`@effected/jsonl`](packages/jsonl.md) shipped with three of its four acceptance criteria met. The fourth — collapsing a dogfood file fan-out into one journal partitioned by `scope` — failed on two counts: terminal and quiescent semantics are journal-wide, so one scope's terminal event freezes every other scope's appends; and `latest` has no sliced counterpart, so per-scope current state costs `O(history)`.

The verified boundary is that **`Slice` is load-bearing for subscription, query and projection, and is not load-bearing for current-state or lifecycle.** The open work is `latest(slice)` as a per-scope `SubscriptionRef` plus per-scope terminal semantics. Consumer-gated: build it when a real consumer needs the collapse.

### `markdown`: the consumer-side finish

[`@effected/markdown`](packages/markdown.md) is complete as a package. What remains is consumer-side — the docs pass and the `rspress-plugin-api-extractor` swap — and it is a consumer port rather than package work.

### Format-package parity hardening

Three items remain from the format-package sweep, in execution order:

1. **Frontmatter completion in `markdown`** — lift `MarkdownFormat.modify`'s frontmatter refusal so frontmatter updates flow through the edit layer.
2. **Format range-filter posture** — the four format packages document three different postures; standardize on one.
3. **Promote the parity contract** in [effect-standards.md](effect-standards.md) from shape-identical to behavior-identical, once the two items above make that assertable.

### Effect prerelease cadence

Advance the Effect catalogs to the newest prerelease promptly after each phase of major work: the Effect team publishes caret peer ranges, so live applications already resolve the newest one and the kit should test against what consumers actually run. The advance is the user-run `pnpm pnpm:up` / `pnpm pnpm:export` flow, with the `.repos/effect` re-pin folded into the same commit ([architecture.md](architecture.md#re-pinning-when-the-effect-catalog-bumps)) and a full-kit verification after.

## Application-tier abstractions to evaluate

Core's `effect/unstable/workflow` (durable workflows: `Workflow`, `Activity`, `DurableClock`/`DurableDeferred`/`DurableQueue`, `WorkflowEngine`) is a strong abstraction for **applications** — long-running, resumable, multi-step operations with retry semantics. It is not kit-library surface, but the consumer ports should evaluate it where the shape fits: DepsRegen's plan/execute phases, silk-update-action's multi-step update runs and any future release automation are the natural candidates. Adopt it where a consumer's port genuinely has durable multi-step state, never speculatively.

## The tsgo LSP track

Parallel and experimental. A time-boxed spike **in this repo** proving end-to-end: patched `typescript` plus the [`@effect/tsgo`](https://github.com/Effect-TS/tsgo) language server giving agents real-time feedback while they work, with the patch applied via pnpm patching. Only after the spike proves out does packaging happen: the [config companion](#the-config-companion) carries the patch and a `tsconfig/lsp.json`, and a plugin skill teaches agents the setup. Failure is cheap by design — if the spike fails, or TypeScript 7.1 ships an official API story first, the loss is a spike, not a package.

## Consumer ports

External repos. These are **pull, not push** — they proceed whenever their inputs exist and never block kit packages. All run against real published packages.

The github-split consumers are **done** and are not roadmap items: what their migration produced is [github-action-canon.md](github-action-canon.md), the shape a kit-based action takes. Still open:

- **rspress-plugin-api-extractor** — a full application port, not a dependency swap: the plugin's v3 `*-effect` dependencies cannot coexist with the v4 kit. Twoslash type-checking keeps `typescript@6` as a direct dependency, the sanctioned island until the TypeScript 7.1 JS API exists.
- **@savvy-web/bundler** (savvy-web/systems) — its TS usage is syntactic parser plus config API only, no type checker. `tsconfig-json` replaces its tsconfig resolver; the `dts/` AST walkers wrap plain `typescript` calls in Effect.
- **vitest-agent**, **@soda3js/config** and the **runtime-resolver CLI re-ship**.
- **savvy-web/systems'** DepsRegen, plus the `savvy` CLI and MCP adapters over it — the consumer that scoped `workspaces`' point-in-time functionality alongside silk-update-action.

**The dogfood pattern to expect from a port depends on whether the consumer is first.** The github-split ports reported no missing capability between them: every item was a *projection* the consumer had to write between two things the kit already owned — OIDC claims to a provenance predicate, check state to a document, a row type to a table — and got wrong in a way that typechecked. Prefer absorbing the projection over documenting the hazard.

A **first** consumer of a surface reports differently, and [reposets](consumers/reposets.md) is the worked case: first to drive `app` and `store` from outside, first to run at a terminal, and it found absence rather than mis-projection — a resolver chain, a read-through cache, a UTF-8 codec, decode options, six unrepresented GitHub route families, and the whole `@effected/cli` boundary. Two of those it wrote downstream against a design doc for this repo to fold in. **Plan the first port onto any new surface as a design round, not an absorption round**, and expect the surface to change shape rather than merely gain a method.

## The TypeScript 5→6→7 posture

TypeScript 7 (the Go rewrite) ships tsc but no JS-compatible API until 7.1, whose timing is unknown. The rule that threads through everything: **`@effected/*` packages never import `typescript`**. `tsconfig-json` owns the version-coupled enum mappings as data. Direct TS-API usage is confined to external consumers — the api-extractor plugin carries `typescript@6` directly for Twoslash — until the TS 7.1 JS API exists, at which point the island is revisited. The workspace itself typechecks under TypeScript 7 (`catalog:build`), and because the one package that kept the compiler behind optional peers is [no longer in the kit](package-inventory.md#not-in-the-kit), the posture holds at the package-set level rather than only behind optional peers.

## Decided against

### `@effected/errors`

A shared cross-package errors package was rejected, for four reasons:

1. The kit already has a shared error vocabulary — `effect` core's `PlatformError`, `SqlError` and Schema parse issues are the errors that genuinely cross every boundary.
2. A central errors package is a barrel with different syntax — the same coupling argument that forbids the codec namespace object — and it inverts ownership: each package's error model is part of its designed API surface, and centralizing it makes every error change a cross-package release event.
3. Effect's error channel composes unions structurally — tagged errors discriminate on `_tag`, `catchTag` narrows, and `Effect<A, WalkerError | ConfigParseError>` flows across package boundaries with no nominal coordination.
4. The genuine cross-boundary case already has a house pattern, `@effected/npm`: when an error must cross a boundary it travels with the contract it belongs to, into a small package named for the contract, never into a generic errors package.

Convention drift — error shape, `_tag` naming, structure-preserving fields — is already legislated in [effect-standards.md](effect-standards.md).
