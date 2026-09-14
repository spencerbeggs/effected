# CLAUDE.md

## Project Overview

This is **effected**, a pnpm monorepo (npm org `@effected`) building an **Effect v4 app kit**: a coherent set of libraries designed v4-first. Scope is closed by five consuming applications, not by how many source repos remain.

The monorepo holds libraries only — applications stay in external repos.

**Releases are changeset-driven: CI builds the changesets and releases the packages they name.** A release may be the whole kit or a single package — both are ordinary. Everything published is `0.x` and unstable; `1.0.0` waits for Effect v4 GA.

## Knowledge bundle

Durable project knowledge lives as OKF concepts under `okf/`, not in prose here. Start at `okf/index.md` — it lists every concept — then load the specific one a task needs:

- Project purpose, scope, packages table, consumers → `okf/project.md`.
- Workspace root (layout, build pipeline, dependency resolution, vendored source) → `okf/modules/workspace.md` — Load when: changing repo structure, build pipeline, tooling, or workspace/catalog setup.
- Effect standards (schema, services/layers, error handling, observability, input hardening, testing, dependency policy, requiring core in `R`) → `okf/conventions/schema-standards.md`, `service-and-layer-standards.md`, `error-standards.md`, `observability-standards.md`, `input-hardening-standards.md`, `testing-standards.md`, `dependency-policy.md`, `require-in-r-default.md`, `peer-dependency-discipline.md` — Load when: designing or porting a library API, asking whether core already owns a primitive *and whether its shape fits the call site*, choosing a test double, or making dependency/peer-closure decisions.
- Release model and catalog sync → `okf/decisions/release-model.md`, `okf/interfaces/catalog-sync-cli.md`, `okf/gotchas/catalog-sync-check-goes-red-when-it-repairs.md` — Load when: reasoning about how a release is cut or versioned, scoping a package against its consumers, or touching the published `effected` catalog literal, the `catalog:sync` / `catalog:check` scripts, or `.github/workflows/catalog-sync.yml`.
- Fork pull requests → `okf/runbooks/enable-fork-pull-request-review.md`, `okf/gotchas/unprotected-environment-runs-fork-code-with-secrets.md` — Load when: a PR from a fork shows a waiting or failed `Fork Approval` job, or enabling the gate on a repository.
- Adding a package → `okf/runbooks/add-a-kit-package.md`, `okf/runbooks/add-a-workspace-package.md` — Load when: starting a new `@effected` library or scaffolding a new workspace package.
- Format packages (parse/format/edit surface, fidelity guarantee, sync-vs-effectful primitives) → `okf/conventions/format-package-convention.md`, `okf/conventions/sync-primitive-policy.md` — Load when: designing a formatting or parsing entry point, or reasoning about a formatter's fidelity guarantee.
- Plugins → `okf/modules/claude-code-plugin.md`, `okf/modules/copilot-plugin.md` — Load when: working in `plugins/` on the "effected" Claude Code plugin or its experimental Copilot port.
- Construct index → `okf/models/construct-annotations.md`, `okf/conventions/construct-index-is-generated.md` — Load when: adding or annotating an exported construct, or touching `generate-constructs.mts` / `construct-annotations.json`.
- GitHub Action canon → `okf/conventions/github-action-canon.md` — Load when: building or reviewing a GitHub Action repository on the kit, or editing the Actions skill suite that teaches it.
- Scratchpad → `okf/modules/scratchpad.md` — Load when: changing the scratchpad workspace's committed shell or its ghost-workspace exclusions.
- Consumers (the external applications that scope the kit) → `okf/consumers/` — Load when: reasoning about who a capability serves, or surveying what a consumer already exercises.
- A specific package → `okf/modules/<pkg>.md` (one per `packages/*`) — Load when: working inside that package.

### Detail folded into the bundle

- Package roster with tiers and provenance → `okf/project.md` — Load when: choosing which package owns a capability, or checking a package's tier or scope.
- Build and test mechanics (turbo/bundler pipeline, typechecking, vitest pre-build and gates) → `okf/modules/workspace.md`, `okf/conventions/build-through-turbo-only.md`, `okf/conventions/testing-standards.md`, `okf/conventions/evidence-ladder.md`, `okf/conventions/state-the-reason-when-a-gate-count-moves.md` — Load when: asking how the turbo/bundler pipeline, typechecking or the vitest setup actually works.
- Dependency catalogs and peer closure → `okf/modules/workspace.md`, `okf/conventions/peer-dependency-discipline.md`, `okf/conventions/one-resolved-effect-copy.md`, `okf/gotchas/expected-peers-check-occupant.md` — Load when: reading a `pnpm peers check` warning, or touching catalogs and peer declarations.
- Vendored repos → `okf/modules/workspace.md`, `okf/runbooks/sync-vendored-repos.md`, `okf/runbooks/advance-the-effect-pin.md` — Load when: consulting, syncing or re-pinning `.repos/effect` or a sibling vendored submodule.

### Kit composition

The kit is **31 publishable packages**: 30 libraries plus the `pnpm-plugin-effect` companion, and all 31 have published (`schema-org`, the newest, on 2026-08-26). New packages follow `okf/runbooks/add-a-kit-package.md`: an `okf/modules/<pkg>.md` Module concept first, then port.

`@effected/config-file` holds every config **codec**; the `jsonc`, `yaml` and `toml` **format** packages stay independent. The four codecs are **free-standing named exports** — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`, one module each — with `ConfigCodec` the interface only. **Never collect them into a namespace object**: it would drag every parsing engine into a JSON-only consumer's bundle, killing tree-shaking silently. Read `okf/modules/config-file.md` and `okf/decisions/codecs-are-free-standing-named-exports.md` before touching it.

`okf/project.md` is authoritative on packages and consumers — read it before starting work.

## Repository Layout

- `packages/` — the workspace packages.
- `plugins/` — two agent plugins: `claude-code/` ("effected", skills and specialist agents) and the experimental `copilot/` port. Each has a private tracking package — `@effected/claude-code-plugin`, `@effected/copilot-plugin` — that versions and tags it but **never publishes to npm**; a plugin release is a git tag plus a GitHub release. Read `plugins/CLAUDE.md` before working there.
- `website/` — RSPress docs site; per-package api-extractor models live in `website/lib/models/`.
- `scratchpad/` — private agent-probe workspace: every kit package at `workspace:*`, three runners, never published, invisible to CI. Read `scratchpad/CLAUDE.md` before working there.
- `.repos/effect` — read-only vendored Effect v4 source; the authority on what v4 exports. Sibling submodules vendor spec inputs for specific packages (the CommonMark/mdast set). **Never write to anything under `.repos/`** — silk's PreToolUse guards deny it. Detail → `okf/modules/workspace.md`, `okf/conventions/no-writes-under-repos.md`.
- **A generator's data input is a committed file, not a submodule.** `@effected/spdx` and `@effected/schema-org` each read one published document from their own `lib/data/`. Vendoring those as submodules cost every clone and every CI checkout the upstream repos' full history — 1.86 GB and 254 MB — to reach 332 KB and 1.5 MB of JSON, and roughly tripled CI checkout time. Submodule a source repo when the package needs to *read the repo*; commit the file when it needs one file.
- `.claude/skills/improve` — project-level skill that maintains `plugins/claude-code/skills/`.

### Package context files

Each package has its own `CLAUDE.md` and documents itself. Read it before working there; do not duplicate its content here. The roster of all 31 — what each one is, and the parenthetical tier tag every **library** carries (pure / boundary / integrated, per `okf/glossary/library-tier.md`) — lives in `okf/project.md`'s packages table. Load it when: choosing which package owns a capability, or checking a package's tier or scope before working in it.

## Build Pipeline

Builds run through turbo and `@savvy-web/bundler`; mechanics → `okf/modules/workspace.md`, `okf/conventions/build-through-turbo-only.md`. The rules:

**Never run `node savvy.build.ts --target prod` directly.** It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. Build through `pnpm build --filter <pkg>`.

**A clean build log does not prove a build ran either** — a turbo cache hit replays the previous run's output verbatim. The tell is `dist/<target>/issues.json`'s `generatedAt`, which must postdate your last source edit.

**Never put `@savvy-web/bundler` in `dependencies`** — it is every building package's `devDependency`; there, the published manifest ships a build tool at runtime.

**Source `package.json` files are `"private": true`** — intentional; never set `"private": false`, and never infer from it that a package will not publish. The bundler's `publishConfig` transform produces the publishable manifest at build time, and publishability is `publishConfig.access === "public"`.

**Every package typechecks with `tsc --noEmit`** (`types:check`), on `typescript` from `catalog:build` — which a configDependency injects, so its absence from `pnpm-workspace.yaml` is expected and must never be "repaired".

**The root `tsconfig.json` sets `skipLibCheck: true`, and that override is deliberate — do not remove it.** The silk preset sets no `skipLibCheck`, so it defaults false and the root program typechecks dependencies' shipped declarations. `vitest@5.0.0` ships a broken one — `dist/chunks/plugin.d.ts` imports `MarkOptions` from `vitest/browser`, which `dist/browser.d.ts` does not export — and it was the ONLY error in the whole root program, failing the pre-commit hook's `tsc --noEmit` on every commit in the repo. Drop the override once vitest ships a consistent `.d.ts`; per-package `types:check` is unaffected either way.

## Commands

**User-run only:** `pnpm pnpm:up`, `pnpm pnpm:preview` and `pnpm pnpm:export` advance and export the Effect catalogs, mutating the lockfile and the root `pnpm-workspace.yaml`. **Agents must not invoke them** — surface the command and let the user run it (advancing the Effect pin is `pnpm:up` then `pnpm:export`).

**Agents may run** `pnpm catalog:check` (read-only drift gate) and `pnpm catalog:sync`, which write nothing but `packages/pnpm-plugin-effect/savvy.build.ts` and one fixed-name changeset. They keep the published `effected` catalog current — do not lump them in with the `pnpm:*` class.

**A release does not need a hand-run `catalog:sync` — CI guarantees it.** `.github/workflows/catalog-sync.yml` runs on every PR to `main` **and to `changeset-release/main`**, so opening the release PR is itself the trigger: the job syncs the catalog, writes `.changeset/catalog-sync.md`, and the release PR picks up the resulting plugin bump before publishing. The catalog therefore cannot publish out of step with the packages it names.

**That guarantee covers direct bumps; membership and dependency ripples each needed their own answer, and the two resolve oppositely.** The upgrade CLI walks the catalog literal, so a package absent from it is invisible to the sync and cannot be added by one, and a package bumped only as a dependency **ripple** carries no changeset naming it, so the CLI cannot see that either. `catalog:check` now fails on both, naming the affected packages. From there they part company:

- **A membership gap is yours to close by hand**, at the `PnpmConfigPlugin(...)` call site — `catalog:sync` refuses before writing rather than guessing, because a new package's first release range is a judgement rather than something derivable from the workspace.
- **A ripple gap closes itself.** `catalog:sync` reads the real release plan from `changeset status --output` and rewrites the affected entries, flooring each peer patch per `lock-minor`. Do not hand-edit one — the next sync overwrites it.

Two properties of that job surprise readers, and neither is a bug:

- **It checks out `ref: main` and commits to `main`, not to the PR head.** It uses the PR event as a trigger to keep *main's* catalog fresh; it is not validating the PR's own contents. A feature branch's pending changesets reach it only once merged.
- **The reported check run goes RED when it found drift and repaired it** (`Catalog was out of date — synced`). That is deliberate — a run that silently fixes drift teaches nobody it happened — and it goes green on a re-run once the sync commit is in the branch. Do not read that red as a failed sync.

## Code Quality and Hooks

Biome, commitlint, lint-staged and markdownlint take their presets from `@savvy-web/silk` (configs at the repo root and in `lib/configs/`), which is in active development — read `node_modules/@savvy-web/` when behavior surprises you.

**Never invoke `markdownlint-cli2` directly — run `pnpm lint:md` or `pnpm lint:md:fix`.** The tool *merges* explicit path arguments with the config's repo-wide `globs` rather than narrowing to them, so "lint just my file" lints the whole repo. The config deliberately omits `fix` (present, it overrides `--fix`) so the flag decides.

**Never run `git checkout` / `git restore` / `git stash` to undo unexpected working-tree changes** — other agents and earlier steps hold uncommitted work there. Inspect the diff and repair what is actually wrong.

## Conventions

### Dependencies

Shared dependency versions come from pnpm catalogs in `pnpm-workspace.yaml`, managed via `packages/pnpm-plugin-effect`. Catalog detail and the expected peer-warning class → `okf/modules/pnpm-plugin-effect.md`, `okf/conventions/peer-dependency-discipline.md`, `okf/gotchas/expected-peers-check-occupant.md`.

**`catalog:effect` uses the `lock` strategy: exact prerelease pins (`4.0.0-rc.112`), never a caret.** A caret on a prerelease floats across the release line and silently desynchronizes the installed `effect` from the `.repos/effect` submodule, the authority on what v4 exports.

**Always check the lockfile diff after an install** — a plain `pnpm install` can strip turbo/biome/tsgo platform binaries from it.

### Commits

All commits require conventional commit format (`feat`, `fix`, `chore`, ...) and a DCO signoff (`Signed-off-by: Name <email>`).

Commit bodies allow dash bullets (the preferred shape) but no markdown headers, numbered lists, code fences, links, or more than two inline-code spans (`silk/body-no-markdown`). `design:` is not a valid commit type.

## Testing

Vitest with the `@vitest-agent/plugin` `AgentPlugin`; tests live in each package's `__test__/` directory, never co-located in `src/`. Test Effect code with `@effect/vitest` and assert with `assert.*` — **never `expect`**. Setup detail → `okf/modules/workspace.md`, `okf/conventions/testing-standards.md`.

**A test needing `FileSystem` provides `@effected/memfs`, never a hand-rolled `FileSystem.layerNoop` double** — `layerNoop` is deny-by-default, so a stub encodes only what its author remembered. Inject misbehaviour as a fault handler, not a stub body; riders in `effect-standards.md`.
