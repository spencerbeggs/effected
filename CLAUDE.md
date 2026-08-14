# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

This is **effected**, a pnpm monorepo (npm org `@effected`) building an **Effect v4 app kit**: a coherent set of libraries designed v4-first, not a lift-and-shift of Spencer's older `*-effect` repos. Scope is closed by five consuming applications, not by how many source repos remain.

The monorepo holds libraries only — applications stay in external repos.

**Releases are changeset-driven: CI builds the appropriate changesets and releases the packages they name.** A release may be the whole kit or a single package — both are ordinary. Everything published is `0.x` and unstable; `1.0.0` waits for Effect v4 GA.

## Design Documentation

Twelve foundational design docs live in `.claude/design/effected/` (config: `.claude/design/design.config.json`). Load them on demand:

- Architecture → `@./.claude/design/effected/architecture.md` — Load when: changing repo structure, build pipeline, tooling, or workspace/catalog setup.
- Effect standards → `@./.claude/design/effected/effect-standards.md` — Load when: designing or porting a library API, or making dependency/peer-closure decisions.
- Package inventory → `@./.claude/design/effected/package-inventory.md` — Load when: picking the next migration target or updating a package's migration status.
- Releases → `@./.claude/design/effected/releases.md` — Load when: reasoning about how a release is cut or versioned, scoping a package against its consumers, or asking why a given package had to exist for the (now closed) `0.1.0` gate.
- Roadmap → `@./.claude/design/effected/roadmap.md` — Load when: planning post-migration work or picking the next workstream.
- Migration playbook → `@./.claude/design/effected/migration-playbook.md` — Load when: starting or continuing a package migration.
- Package setup → `@./.claude/design/effected/package-setup.md` — Load when: scaffolding or adding a new workspace package.
- Formatter convention → `@./.claude/design/effected/formatter-convention.md` — Load when: designing a formatting or parsing entry point, or reasoning about a formatter's fidelity guarantee.
- Sync primitive policy → `@./.claude/design/effected/sync-primitive-policy.md` — Load when: designing a pure boundary's surface shape, or deciding whether to expose a sync `Result` primitive alongside an `Effect` form.
- Plugin → `@./.claude/design/effected/plugin.md` — Load when: working in `plugin/` on the "effected" Claude Code plugin.
- GitHub Action canon → `@./.claude/design/effected/github-action-canon.md` — Load when: building or reviewing a GitHub Action repository on the kit, or editing the Actions skill suite that teaches it.
- Scratchpad → `@./.claude/design/effected/scratchpad.md` — Load when: changing the scratchpad workspace's committed shell or its ghost-workspace exclusions.

Per-package design docs live in `.claude/design/effected/packages/`; consumer dogfood records live in `.claude/design/effected/consumers/`.

### Child context files

Detail lifted out of this file. Load on demand:

- Build and test mechanics → `@./CLAUDE.build-and-test.md` — Load when: asking how the turbo/bundler pipeline, typechecking or the vitest setup actually works.
- Dependency catalogs and peer closure → `@./CLAUDE.dependencies.md` — Load when: reading a `pnpm peers check` warning, or touching catalogs and peer declarations.
- Vendored Effect source → `@./CLAUDE.vendored-effect.md` — Load when: consulting, syncing or re-pinning `.repos/effect`.

### Kit composition

**The migration program is complete (2026-07-12).** The kit is **28 publishable packages**: 27 libraries plus the `pnpm-plugin-effect` companion. `@effected/cli` is the newest, built from the `@spencerbeggs/reposets` dogfood loop and unreleased. New packages follow the migration playbook: design doc first, then port.

**The config-file consolidation is done.** `@effected/config-file` absorbed the three codec packages; the `jsonc`, `yaml` and `toml` **format** packages stay independent. The four codecs are **free-standing named exports** — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`, one module each — with `ConfigCodec` the interface only. **Never collect them into a namespace object** (a barrel with different syntax): referencing one reaches every codec and drags every parsing engine into a JSON-only consumer's bundle, so tree-shaking dies silently. Read `@./.claude/design/effected/packages/config-file.md` before touching it.

`package-inventory.md` and `releases.md` are authoritative — read them before starting work.

## Repository Layout

- `packages/` — the workspace packages (see below).
- `plugin/` — "effected", a Claude Code plugin (skills and specialist agents, counted in `plugin/skills/` and `plugin/agents/`) dogfooded during package work; in development.
- `website/` — RSPress docs site; per-package api-extractor models live in `website/lib/models/`.
- `scratchpad/` — private agent-probe workspace: every kit package at `workspace:*`, three runners (`pnpm scratchpad:probe <file>`, vitest project `scratchpad`, `pnpm scratchpad:check`), reset via `pnpm scratchpad:reset`. Never published, changeset-ignored, invisible to CI. Read `scratchpad/CLAUDE.md` before working there.
- `.repos/effect` — read-only vendored Effect v4 source; the authority on what v4 exports. **Never write to anything under `.repos/`**, by any means, with any tool — silk's PreToolUse guards deny it. Fresh clones start empty. Detail → `@./CLAUDE.vendored-effect.md`.
- `.claude/skills/improve` — project-level skill that maintains `plugin/skills/`.

### Package context files

Each package has its own `CLAUDE.md` and documents itself. Read it before working there; do not duplicate its content here. Parenthetical tags mark each **library's** tier (pure / boundary / integrated) per `effect-standards.md`; the companion has none.

- `semver` — strict SemVer 2.0.0 schemas; the repo's DX north star (pure).
- `jsonc` — zero-dependency JSONC parse/edit/format schemas (pure).
- `yaml` — zero-dependency YAML 1.2 parse/edit/format schemas, per-node comment fidelity, a public token stream and a yamllint-class lint system with autofix; largest package in the repo (pure).
- `toml` — TOML parse/edit/format on a from-scratch engine (pure). **The two directions differ deliberately:** `parse` accepts the full TOML 1.1.0 grammar, `stringify` emits only 1.0.0 spellings — do not "fix" either side to match the other.
- `markdown` — CommonMark 0.31.2 + GFM as pure schemas: parse to mdast-shaped nodes with byte offsets, edit, format, mdast projection, frontmatter codecs; second in size only to `yaml` (pure).
- `glob` — the full minimatch dialect as pure string→predicate schemas; vendored, hardened engine (pure).
- `spdx` — SPDX identifiers, exceptions and license expressions as Schema classes; vendors the datasets as devDep-generated TypeScript (pure).
- `lockfiles` — bun/npm/pnpm/yarn lockfile parsers normalized into one `Lockfile` model, plus pure integrity checking (pure).
- `package-json` — package.json schemas, validation and file IO; delegates core SPDX validity to `@effected/spdx` (boundary).
- `tsconfig-json` — tsconfig.json schemas, `extends`-chain resolution and config discovery (boundary).
- `config-file` — composable config file loading: codec × resolver × strategy, the four codecs as free-standing named exports (boundary). Zero *external* runtime dependencies; peers on `jsonc`, `yaml` and `toml`.
- `npm` — resolution contracts for `catalog:` / `workspace:` specifiers plus the `NpmRegistry` and `PackagePublish` services, which do their own IO through core contracts in `R` (boundary, deliberately — not integrated).
- `walker` — upward path traversal; the one absorbing loop (boundary).
- `xdg` — XDG Base Directory resolution: `AppDirs`, `NativeDirs`, `XdgPaths` and the config-file resolvers, over `walker` (boundary).
- `commands` — structured command running (`Run`) and CLI tool discovery (`ToolDiscovery`) over core's `ChildProcessSpawner`; declares the narrow `LocalExec` contract `workspaces` implements, keeping zero `@effected/*` edges (boundary).
- `git` — typed git introspection plus a marked mutating tier, a pure `GitConfig`/`Gitmodules` core, and argv redaction in `GitCommandError`, over core's ChildProcessSpawner in `R` (boundary).
- `templates` — managed `BEGIN`/`END` sections in files whose surrounding content belongs to the user; `FileSystem` required in `R`, `Path` deliberately not (boundary).
- `jsonl` — append-only, schema-validated JSONL journals as a definable service: envelope contract over a per-file event registry, a pure sync core, `Slice`-filtered reads that never materialize the file, an always-on watcher (boundary).
- `runtimes` — resolve semver-compatible Node, Bun and Deno versions from live feeds with an offline snapshot; its CLI binary ships from an external repo so consumers never install `@effect/platform-node` (boundary).
- `store` — durable local state: a migrated, schema-versioned SQLite `Store` and a TTL `Cache` with tag invalidation and eviction (integrated).
- `workspaces` — monorepo tooling: discovery, dependency graph, package-manager detection, pnpm catalogs, lockfile IO, git change detection; implements `npm`'s resolver contracts and `commands`' `LocalExec` (integrated). `PublishabilityDetector` is a seam with **no ambient default** — provide `layerNpm` (or your own) wherever your program's `R` names it.
- `github` — typed GitHub REST/GraphQL over octokit, with App auth, the resource services and the configuration-write half (secrets, variables, rulesets, environments); owns the octokit runtime, and the sealed-box crypto pair, so nothing downstream has to (integrated).
- `github-actions` — the Actions runtime services, the GitHub-surfaces reporting suite and the `sbom` seam adapters; the **one** package with `@effect/platform-node` as a required peer, and the only in-kit consumer of `templates`, `markdown` and `sbom` (integrated).
- `sbom` — supply-chain artifacts: CycloneDX 1.6 SBOMs, the NTIA minimum-elements report, in-toto statements and SLSA provenance, Sigstore DSSE signing (integrated).
- `schemastore` — Effect Schemas published as SchemaStore-shaped Draft-07 documents: `StoreDocument` assembly, catalog modes, fileMatch lint, `DocumentDiff`, write-if-changed `SchemaFile` IO, ajv-backed validation (integrated).
- `cli` — the CLI **boundary**: `CliLogger` (plain lines, `Error`+ to stderr), `CliRuntime` (report failures through the program's own logger, set the exit code) and the two issue renderers. Not a CLI framework — `effect/unstable/cli` owns parsing and this must never grow a second one. `@effected/config-file` is an **optional** peer, which holds only because `ConfigIssueRenderer` is a module nothing else imports (boundary).
- `app` — the application control plane: one layer wiring XDG-namespaced directories, a migrated SQLite `Store`, a TTL `Cache` and a config file to the same place (integrated). Nothing may depend on it.
- `pnpm-plugin-effect` — pnpm catalog/config plugin. The kit's one **companion**: published and installable but not a library, so it has **no tier**. It **is published to npm** like every library here, not an exception.

## Build Pipeline

Builds run through turbo and `@savvy-web/bundler`; mechanics → `@./CLAUDE.build-and-test.md`. The rules:

**Never run `node savvy.build.ts --target prod` directly.** It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. Build through `pnpm build --filter <pkg>`.

**Never put `@savvy-web/bundler` in `dependencies`** — it is a `devDependency` of every package that builds, and in `dependencies` the publishable manifest ships a build tool at runtime.

**Source `package.json` files are `"private": true` — this is intentional; never set `"private": false` in source.** The bundler's `publishConfig` transform produces the publishable manifest at build time. **Never infer from `"private": true` that a package will not publish** — every source manifest here is private.

**Every package typechecks with `tsc --noEmit`** (`types:check`), on `typescript` from `catalog:build`. `catalog:build` is **not** declared in `pnpm-workspace.yaml`; it is injected by the `@savvy-web/pnpm-plugin-silk` configDependency — its absence there is expected, not a bug to repair by adding it.

## Commands

### User-run maintenance commands

`pnpm pnpm:up`, `pnpm pnpm:preview` and `pnpm pnpm:export` advance and export the Effect catalogs. They mutate the lockfile and the root `pnpm-workspace.yaml`.

**Agents must not invoke them.** Surface the command and let the user run it; advancing the beta is `pnpm pnpm:up` then `pnpm pnpm:export`.

## Code Quality and Hooks

Biome, commitlint, lint-staged and markdownlint take their presets from `@savvy-web/silk`; configs live at the repo root and in `lib/configs/`. The `@savvy-web/*` packages are in active development — if behavior seems unexpected, read the installed source in `node_modules/@savvy-web/`.

**Never invoke `markdownlint-cli2` directly — run `pnpm lint:md` or `pnpm lint:md:fix`.** The tool *merges* explicit path arguments with the config's repo-wide `globs` rather than narrowing to them, so "lint just my file" lints the whole repo. The config deliberately omits `fix` (present, it overrides `--fix` in both directions) so the flag decides.

**Never run `git checkout` / `git restore` / `git stash` to undo unexpected working-tree changes.** Other agents and earlier steps hold uncommitted work there. Inspect the diff and repair what is actually wrong.

## Conventions

### Dependencies

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml`, managed via `packages/pnpm-plugin-effect`. Catalog detail and the expected peer-warning class → `@./CLAUDE.dependencies.md`.

**`catalog:effect` uses the `lock` strategy: exact beta pins (`4.0.0-beta.107`), never a caret.** A caret on a prerelease floats across the beta line and silently desynchronizes the installed `effect` from the `.repos/effect` submodule, the authority on what v4 exports.

**Always check the lockfile diff after an install** — a plain `pnpm install` once stripped turbo / biome / tsgo platform binaries from it.

### Commits

All commits require conventional commit format (`feat`, `fix`, `chore`, ...) and a DCO signoff (`Signed-off-by: Name <email>`).

Commit bodies allow dash bullets (the preferred shape) but no markdown headers, numbered lists, code fences, links, or more than two inline-code spans (`silk/body-no-markdown`). `design:` is not a valid commit type.

## Testing

Vitest with the `@vitest-agent/plugin` `AgentPlugin`; tests live in each package's `__test__/` directory, never co-located in `src/`. Test Effect code with `@effect/vitest` and assert with `assert.*` — **never `expect`**. Setup detail → `@./CLAUDE.build-and-test.md`.
