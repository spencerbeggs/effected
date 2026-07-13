---
status: current
module: effected
category: architecture
created: 2026-07-12
updated: 2026-07-12
last-synced: 2026-07-12
completeness: 90
related:
  - releases.md
  - package-inventory.md
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - packages/runtimes.md
  - packages/app.md
---

# Roadmap

## Overview

The migration program is complete: seventeen library packages plus the [companion](effect-standards.md#companion-packages-published-but-not-a-library), ending with `@effected/app` (merged 2026-07-12, [packages/app.md](packages/app.md)). This doc records what comes after it — the decisions came out of a brainstorming session on 2026-07-12, grounded in surveys of the v3 extraction sources (silk-effects' ManagedSection and ToolDiscovery, @savvy-web/bundler's tsdown-plugins `dts/` helpers, rspress-plugin-api-extractor's tsconfig-parser). These are settled decisions, not proposals, recorded with their reasoning so they are not re-litigated.

The sequencing decision is **unblock-first**: the `0.1.0` gate deliberately expands by exactly one new package (`@effected/tsconfig-json`) plus a package reshape, so that `0.1.0` publishes the final near-term package set and the gate-proving consumer port lands on final packages. [releases.md](releases.md)'s gate table stays authoritative; it and [package-inventory.md](package-inventory.md) are updated as each item below lands, per [migration playbook](migration-playbook.md) step 7 — this doc does not replace them.

## The revised 0.1.0 gate

Four workstreams. The release still ships seventeen library packages plus the companion — same count as today, different composition: the runtimes reshape is net minus one (the rename keeps the package under a new name; the CLI removal drops one) and `tsconfig-json` is net plus one, back to seventeen.

### 1. Merge `app`

Done — merged 2026-07-12 (PR #73). See [releases.md](releases.md#the-gate) and [packages/app.md](packages/app.md).

### 2. The runtimes reshape

Rename `@effected/runtime-resolver` → `@effected/runtimes` and delete `@effected/runtime-resolver-cli` from the workspace entirely.

**The rename half landed 2026-07-12.** `packages/runtime-resolver` → `packages/runtimes`, the package name, service tag ids and every design/website reference moved with it — see [packages/runtimes.md](packages/runtimes.md#the-runtimes-rename). **The CLI removal half is still pending**: `@effected/runtime-resolver-cli` was deliberately kept in the workspace for now, with only its imports repointed at `@effected/runtimes`. The dogfood trial and the workspace deletion below have not happened yet.

The rename passes the same anti-overclaim naming test as the ts-vfs and app renames: "runtime-resolver" bakes resolution semantics into the library's name when resolution is one thing the library does, and AI-adjacent applications oddly need runtime awareness generally — which version of Node, Bun or Deno is available and compatible — not just a resolver. Renames and deletions are free only while nothing is published, the same reasoning that timed the ts-vfs and app renames, which is why this precedes `0.1.0` rather than following it.

The CLI does not die; it moves home. Dogfood trial: link `@effected/runtimes` locally into the external `runtime-resolver` repo (`/Users/spencer/workspaces/spencerbeggs/runtime-resolver`), copy the CLI code back there and get its suite green against the linked package. The CLI re-ships from that external repo after `0.1.0` with new semantics, against the published package. This dissolves the two-package split the CLI forced on the workspace ([packages/runtimes.md](packages/runtimes.md)) — the `@effect/platform-node` isolation the split existed for is now handled by the CLI living in a different repo.

### 3. `@effected/tsconfig-json`

The one new gate package, and a full playbook cycle: design doc first, then port/build.

Scope (settled):

- tsconfig.json schemas built on `@effected/jsonc` for JSONC tolerance.
- Full `extends`-chain resolution, including package-name extends targets — that is plain file/module-path resolution, not compiler machinery.
- Nearest-tsconfig upward discovery, over `@effected/walker`.
- Option values kept string-level as literal-union schemas, with a small optional codec mapping to TypeScript's numeric enum values for consumers feeding a real compiler — the package owns those TS-version-coupled mappings as data.

Hard rule: **zero `typescript` imports** (see [the TypeScript posture](#cross-cutting-the-typescript-567-posture)). Likely boundary tier — IO through core FileSystem/Path, peers on `jsonc` and `walker`, both `@effected/*`.

The evidence base for the scope: a survey of rspress-plugin-api-extractor found its only runtime TS-API usage is four data-shaped calls in tsconfig-parser.ts (`ts.readConfigFile`, `ts.parseJsonConfigFileContent`, `ts.sys`, `ts.flattenDiagnosticMessageText`); the genuine type-checker dependency lives in `@shikijs/twoslash` + `@typescript/vfs`, already isolated behind `@effected/ts-vfs`'s optional peers. A parallel survey of @savvy-web/bundler's tsdown-plugins found its `dts/` helpers use only the syntactic parser (no Program, no checker) and its meta/tsconfig-resolver.ts uses only the config API. So `tsconfig-json` unblocks both the api-extractor plugin's config path and the bundler port.

### 4. The gate proof

Port `rspress-plugin-api-extractor` to Effect v4 against link-swapped `@effected/*` packages (`semver`, `ts-vfs`, `store`, `tsconfig-json`). This is the one representative consumer chosen to prove the gate before publishing; the other gate consumers migrate after `0.1.0` against real published packages.

Recorded honestly: this is a full application port, not a dependency swap — the plugin's v3 `*-effect` dependencies cannot coexist with the v4 kit. It does not block on anything else: Twoslash type-checking keeps `typescript@6` as a direct dependency, the sanctioned island until the TypeScript 7.1 JS API exists.

Then publish everything at `0.1.0`.

## Post-0.1.0 packages

In priority order. Each gets its own spec → plan → implement cycle per the [migration playbook](migration-playbook.md).

### `@effected/commands`

A generalization of silk-effects' ToolDiscovery service (surveyed 2026-07-12: 381 lines, already nearly generic): resolve CLI tools globally on PATH vs locally via the detected package manager's exec (pnpm/npm/yarn/bun), configurable version extraction (flag- or JSON-path-based), source constraints (OnlyLocal/OnlyGlobal/Both/Any) and version-mismatch policies (Report/PreferLocal/PreferGlobal/RequireMatch), plus structured command running with Node and Bun. This pattern has been reinvented repeatedly across Spencer's repos; it earns a package. Peers on `@effected/workspaces` for PackageManagerDetector/WorkspaceRoot. Port note: the v3 code calls `process.cwd()` directly; the v4 design must parameterize that.

### `@effected/templates`

v1 scope is **managed sections only**, ported from silk-effects' ManagedSection (surveyed: 483 lines, FileSystem-only platform surface, silk coupling is cosmetic): delimited BEGIN/END managed-section blocks inside user-editable files, with a parameterized marker phrase and comment-style set (v3 hardcodes "MANAGED SECTION" and `#`/`//` styles), read/isManaged/write/sync/check/remove, and the syncMany document-reconciliation algorithm — the real complexity: splitting a document into spans and section placeholders, reassigning declared blocks to existing slots in document order and placing missing blocks relative to sibling anchors. Whole-file templating joins later only when a v4 consumer demands a concrete shape; the name is allowed to grow into itself.

### The config companion

A silk-pattern companion package — the pattern `@vitest-agent/plugin` and `@savvy-web/silk` follow: ship config JSON files and peer-depend on the mcp/cli tools, so consumers' Claude Code plugins and tooling stay on the same versions. It ships preconfigured tsconfigs, including the tsgo LSP tsconfig once [the spike](#the-tsgo-lsp-track) proves out.

Naming: recommended `@effected/plugin`. `@effected/config` is rejected because it reads as a sibling of `@effected/config-file` and would confuse every import list. Companion category, no tier, like `pnpm-plugin-effect` ([effect-standards.md](effect-standards.md#companion-packages-published-but-not-a-library)).

### `@effected/markdown`

Already earmarked in [releases.md](releases.md#markdown) with a real consumer — the api-extractor plugin's mdast stack. Unchanged; sequenced here.

## The tsgo LSP track

Parallel and experimental. A time-boxed spike **in this repo** proving end-to-end: patched `typescript` + the [`@effect/tsgo`](https://github.com/Effect-TS/tsgo) language server giving agents real-time feedback while they work, with the patch applied via pnpm patching.

Only after the spike proves out does packaging happen: the [config companion](#the-config-companion) carries the patch and a `tsconfig/lsp.json`, and a skill in the "effective" plugin teaches agents the setup. Failure is cheap by design: if the spike fails, or TypeScript 7.1 ships an official API story first, the loss is a spike, not a package.

## Consumer ports

External repos. These are **pull, not push** — they proceed whenever their inputs exist and never block kit packages.

- **rspress-plugin-api-extractor** — on the gate ([the gate proof](#4-the-gate-proof)).
- **@savvy-web/bundler** (savvy-web/systems) — unblocked today: its TS usage is syntactic parser + config API only, no type checker. `tsconfig-json` replaces meta/tsconfig-resolver.ts; the `dts/` AST walkers wrap plain `typescript` calls in Effect. Clean business logic; agents can carry most of the port.
- **vitest-agent**, **@soda3js/config** and the **runtime-resolver CLI re-ship** — post-`0.1.0`, against real published packages.

## Cross-cutting: the TypeScript 5→6→7 posture

TypeScript 7 (the Go rewrite, current 7.0.2) ships tsc but no JS-compatible API until 7.1, whose timing is unknown. The rule that threads through everything above: **`@effected/*` packages never import `typescript`**.

`tsconfig-json` owns the version-coupled enum mappings as data; `ts-vfs` keeps the compiler behind optional peers; direct TS-API usage is confined to external consumers — the api-extractor plugin carries `typescript@6` directly for Twoslash, and the bundler's syntactic walkers do the same — until the TS 7.1 JS API exists, at which point those islands are revisited.

## Decided against

### `@effected/errors` — rejected 2026-07-12

A shared cross-package errors package was considered in the same brainstorming session and rejected, for four reasons:

1. The kit already has a shared error vocabulary — `effect` core's PlatformError, SqlError and Schema parse issues are the errors that genuinely cross every boundary.
2. A central errors package is a barrel with different syntax — the same coupling argument that forbids the codec namespace object — and it inverts ownership: each package's error model is part of its designed API surface (config-file's eight TaggedErrorClass types with per-method narrowed unions is the showcase), and centralizing it makes every error change a cross-package release event.
3. Effect's error channel composes unions structurally — tagged errors discriminate on `_tag`, `catchTag` narrows, and `Effect<A, WalkerError | ConfigParseError>` flows across package boundaries with no nominal coordination.
4. The genuine cross-boundary case already has a house pattern, `@effected/npm`: when an error must cross a boundary it travels **with the contract it belongs to**, into a small package named for the contract (DependencyResolutionError lives with CatalogResolver/WorkspaceResolver), never into a generic errors package.

Convention drift — error shape, `_tag` naming, structure-preserving fields — is already legislated in [effect-standards.md](effect-standards.md).
