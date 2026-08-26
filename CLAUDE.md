# CLAUDE.md

## Project Overview

This is **effected**, a pnpm monorepo (npm org `@effected`) building an **Effect v4 app kit**: a coherent set of libraries designed v4-first. Scope is closed by five consuming applications, not by how many source repos remain.

The monorepo holds libraries only — applications stay in external repos.

**Releases are changeset-driven: CI builds the changesets and releases the packages they name.** A release may be the whole kit or a single package — both are ordinary. Everything published is `0.x` and unstable; `1.0.0` waits for Effect v4 GA.

## Design Documentation

The foundational design docs live in `.claude/design/effected/` (config: `.claude/design/design.config.json`). Load each one on demand:

- Architecture → `@./.claude/design/effected/architecture.md` — Load when: changing repo structure, build pipeline, tooling, or workspace/catalog setup.
- Effect standards → `@./.claude/design/effected/effect-standards.md` — Load when: designing or porting a library API, asking whether core already owns a primitive *and whether its shape fits the call site*, choosing a test double, or making dependency/peer-closure decisions.
- Package inventory → `@./.claude/design/effected/package-inventory.md` — Load when: picking the next migration target or updating a package's migration status.
- Releases → `@./.claude/design/effected/releases.md` — Load when: reasoning about how a release is cut or versioned, or scoping a package against its consumers.
- Roadmap → `@./.claude/design/effected/roadmap.md` — Load when: planning post-migration work or picking the next workstream.
- Migration playbook → `@./.claude/design/effected/migration-playbook.md` — Load when: starting or continuing a package migration.
- Package setup → `@./.claude/design/effected/package-setup.md` — Load when: scaffolding or adding a new workspace package.
- Catalog sync → `@./.claude/design/effected/catalog-sync.md` — Load when: touching the published `effected` catalog literal, the `catalog:sync` / `catalog:check` scripts, or `.github/workflows/catalog-sync.yml`.
- Formatter convention → `@./.claude/design/effected/formatter-convention.md` — Load when: designing a formatting or parsing entry point, or reasoning about a formatter's fidelity guarantee.
- Sync primitive policy → `@./.claude/design/effected/sync-primitive-policy.md` — Load when: designing a pure boundary's surface shape, or deciding whether to expose a sync `Result` primitive alongside an `Effect` form.
- Plugin → `@./.claude/design/effected/plugin.md` — Load when: working in `plugin/` on the "effected" Claude Code plugin.
- GitHub Action canon → `@./.claude/design/effected/github-action-canon.md` — Load when: building or reviewing a GitHub Action repository on the kit, or editing the Actions skill suite that teaches it.
- Scratchpad → `@./.claude/design/effected/scratchpad.md` — Load when: changing the scratchpad workspace's committed shell or its ghost-workspace exclusions.

Per-package design docs live in `.claude/design/effected/packages/`; consumer dogfood records in `.claude/design/effected/consumers/`. Two docs sit beside the roster and are **deliberately off it** — do not "repair" the list by adding them: `yaml-lint.md` is a topic doc for `@effected/yaml`, reached from that package's context files, and `benchmarking.md` designs a system nothing has built yet.

### Child context files

Detail lifted out of this file. Load on demand:

- Package roster → `@./CLAUDE.packages.md` — Load when: choosing which package owns a capability, or checking a package's tier or scope.
- Build and test mechanics → `@./CLAUDE.build-and-test.md` — Load when: asking how the turbo/bundler pipeline, typechecking or the vitest setup actually works.
- Dependency catalogs and peer closure → `@./CLAUDE.dependencies.md` — Load when: reading a `pnpm peers check` warning, or touching catalogs and peer declarations.
- Vendored repos → `@./CLAUDE.vendored-effect.md` — Load when: consulting, syncing or re-pinning `.repos/effect` or a sibling vendored submodule.

### Kit composition

The kit is **31 publishable packages**: 30 libraries plus the `pnpm-plugin-effect` companion. All but `schema-org` — built 2026-08-26, not yet released — have published. New packages follow the migration playbook: design doc first, then port.

`@effected/config-file` holds every config **codec**; the `jsonc`, `yaml` and `toml` **format** packages stay independent. The four codecs are **free-standing named exports** — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`, one module each — with `ConfigCodec` the interface only. **Never collect them into a namespace object**: it would drag every parsing engine into a JSON-only consumer's bundle, killing tree-shaking silently. Read `@./.claude/design/effected/packages/config-file.md` before touching it.

`package-inventory.md` and `releases.md` are authoritative — read them before starting work.

## Repository Layout

- `packages/` — the workspace packages.
- `plugin/` — "effected", a Claude Code plugin (skills and specialist agents), in development.
- `website/` — RSPress docs site; per-package api-extractor models live in `website/lib/models/`.
- `scratchpad/` — private agent-probe workspace: every kit package at `workspace:*`, three runners, never published, invisible to CI. Read `scratchpad/CLAUDE.md` before working there.
- `.repos/effect` — read-only vendored Effect v4 source; the authority on what v4 exports. Sibling submodules vendor spec inputs for specific packages (the CommonMark/mdast set). **Never write to anything under `.repos/`** — silk's PreToolUse guards deny it. Detail → `@./CLAUDE.vendored-effect.md`.
- **A generator's data input is a committed file, not a submodule.** `@effected/spdx` and `@effected/schema-org` each read one published document from their own `lib/data/`. Vendoring those as submodules cost every clone and every CI checkout the upstream repos' full history — 1.86 GB and 254 MB — to reach 332 KB and 1.5 MB of JSON, and roughly tripled CI checkout time. Submodule a source repo when the package needs to *read the repo*; commit the file when it needs one file.
- `.claude/skills/improve` — project-level skill that maintains `plugin/skills/`.

### Package context files

Each package has its own `CLAUDE.md` and documents itself. Read it before working there; do not duplicate its content here. The roster of all 31 — what each one is, and the parenthetical tier tag every **library** carries (pure / boundary / integrated) per `effect-standards.md` — lives in `@./CLAUDE.packages.md`. Load it when: choosing which package owns a capability, or checking a package's tier or scope before working in it.

## Build Pipeline

Builds run through turbo and `@savvy-web/bundler`; mechanics → `@./CLAUDE.build-and-test.md`. The rules:

**Never run `node savvy.build.ts --target prod` directly.** It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. Build through `pnpm build --filter <pkg>`.

**A clean build log does not prove a build ran either** — a turbo cache hit replays the previous run's output verbatim. The tell is `dist/<target>/issues.json`'s `generatedAt`, which must postdate your last source edit.

**Never put `@savvy-web/bundler` in `dependencies`** — it is every building package's `devDependency`; there, the published manifest ships a build tool at runtime.

**Source `package.json` files are `"private": true`** — intentional; never set `"private": false`, and never infer from it that a package will not publish. The bundler's `publishConfig` transform produces the publishable manifest at build time, and publishability is `publishConfig.access === "public"`.

**Every package typechecks with `tsc --noEmit`** (`types:check`), on `typescript` from `catalog:build` — which a configDependency injects, so its absence from `pnpm-workspace.yaml` is expected and must never be "repaired".

## Commands

**User-run only:** `pnpm pnpm:up`, `pnpm pnpm:preview` and `pnpm pnpm:export` advance and export the Effect catalogs, mutating the lockfile and the root `pnpm-workspace.yaml`. **Agents must not invoke them** — surface the command and let the user run it (advancing the Effect pin is `pnpm:up` then `pnpm:export`).

**Agents may run** `pnpm catalog:check` (read-only drift gate) and `pnpm catalog:sync`, which write nothing but `packages/pnpm-plugin-effect/savvy.build.ts` and one fixed-name changeset. They keep the published `effected` catalog current — do not lump them in with the `pnpm:*` class.

**A release does not need a hand-run `catalog:sync` — CI guarantees it.** `.github/workflows/catalog-sync.yml` runs on every PR to `main` **and to `changeset-release/main`**, so opening the release PR is itself the trigger: the job syncs the catalog, writes `.changeset/catalog-sync.md`, and the release PR picks up the resulting plugin bump before publishing. The catalog therefore cannot publish out of step with the packages it names.

**That guarantee covers direct bumps; membership and dependency ripples each needed their own answer.** The upgrade CLI walks the catalog literal, so a package absent from it is invisible to the sync and cannot be added by one. `catalog:check` now fails on a membership gap and on a package bumped only as a dependency ripple (which carries no changeset, so the upgrade CLI cannot see it either), and `catalog:sync` refuses before writing, both naming the affected packages — but closing the gap is a hand edit at the `PnpmConfigPlugin(...)` call site, because a new package's first release range is a judgement rather than something derivable from the workspace.

Two properties of that job surprise readers, and neither is a bug:

- **It checks out `ref: main` and commits to `main`, not to the PR head.** It uses the PR event as a trigger to keep *main's* catalog fresh; it is not validating the PR's own contents. A feature branch's pending changesets reach it only once merged.
- **The reported check run goes RED when it found drift and repaired it** (`Catalog was out of date — synced`). That is deliberate — a run that silently fixes drift teaches nobody it happened — and it goes green on a re-run once the sync commit is in the branch. Do not read that red as a failed sync.

## Code Quality and Hooks

Biome, commitlint, lint-staged and markdownlint take their presets from `@savvy-web/silk` (configs at the repo root and in `lib/configs/`), which is in active development — read `node_modules/@savvy-web/` when behavior surprises you.

**Never invoke `markdownlint-cli2` directly — run `pnpm lint:md` or `pnpm lint:md:fix`.** The tool *merges* explicit path arguments with the config's repo-wide `globs` rather than narrowing to them, so "lint just my file" lints the whole repo. The config deliberately omits `fix` (present, it overrides `--fix`) so the flag decides.

**Never run `git checkout` / `git restore` / `git stash` to undo unexpected working-tree changes** — other agents and earlier steps hold uncommitted work there. Inspect the diff and repair what is actually wrong.

## Conventions

### Dependencies

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml`, managed via `packages/pnpm-plugin-effect`. Catalog detail and the expected peer-warning class → `@./CLAUDE.dependencies.md`.

**`catalog:effect` uses the `lock` strategy: exact prerelease pins (`4.0.0-rc.109`), never a caret.** A caret on a prerelease floats across the release line and silently desynchronizes the installed `effect` from the `.repos/effect` submodule, the authority on what v4 exports.

**Always check the lockfile diff after an install** — a plain `pnpm install` can strip turbo/biome/tsgo platform binaries from it.

### Commits

All commits require conventional commit format (`feat`, `fix`, `chore`, ...) and a DCO signoff (`Signed-off-by: Name <email>`).

Commit bodies allow dash bullets (the preferred shape) but no markdown headers, numbered lists, code fences, links, or more than two inline-code spans (`silk/body-no-markdown`). `design:` is not a valid commit type.

## Testing

Vitest with the `@vitest-agent/plugin` `AgentPlugin`; tests live in each package's `__test__/` directory, never co-located in `src/`. Test Effect code with `@effect/vitest` and assert with `assert.*` — **never `expect`**. Setup detail → `@./CLAUDE.build-and-test.md`.

**A test needing `FileSystem` provides `@effected/memfs`, never a hand-rolled `FileSystem.layerNoop` double** — `layerNoop` is deny-by-default, so a stub encodes only what its author remembered. Inject misbehaviour as a fault handler, not a stub body; riders in `effect-standards.md`.
