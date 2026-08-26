# Vendored repos — effected

Child context file for `.repos/`: the read-only vendored Effect v4 tree and its sibling spec/dataset submodules.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

## What it is

A git submodule of Effect-TS/effect, pinned to the tag matching the `effect` catalog (`effect@4.0.0-rc.109`) and managed by silk's repos tooling. Vendored as **read-only Effect v4 source for agents** — the authority on what v4 actually exports.

It has tracked the main Effect-TS/effect monorepo since 2026-07-19, when the old effect-smol repo was archived and v4 development moved back there; the local path was `.repos/effect-smol` until 2026-07-24 and is now `.repos/effect`, matching what a consuming repo would vendor. Declared in `.gitmodules`; described by the manifest `.repos/config.json` (url / ref / purpose / sparse / orientation / notes).

Sparse checkout: only `packages/effect`, `packages/vitest`, `migration`, `ai-docs`, `LLMS.md` and `MIGRATION.md` are materialized.

## Never write to it

**Never write to `.repos/effect` by any means, with any tool** — the silk plugin's PreToolUse guards deny writes under `.repos/**`. Only the manifest `.repos/config.json` is legitimately editable (notes / orientation / sparse).

## Re-pinning

Re-pin when the catalog bumps, **in the same commit**: `savvy repos pin effect effect@<new-tag>` (or the `repos_manage` MCP tool, action `pin`). Both arguments are **positional** — there is no `--ref` flag, and passing one fails with `Unrecognized flag: --ref`. It stages the gitlink and manifest and returns a ready-made commit message; review any `staleNoteIds` it flags.

Full recipe → `@./.claude/design/effected/architecture.md` — Load when: performing the re-pin.

## Sibling vendored repos

`.repos/` also holds spec submodules a single package checks against — the CommonMark/mdast set (`@effected/markdown`). Same rules: read-only, `savvy repos pin` to re-pin, and a re-pin lands in the same commit as whatever it feeds.

**A single data FILE is committed, not submoduled.** `@effected/spdx` and `@effected/schema-org` generate from one published document each, held in the package's own `lib/data/`. Both were briefly submodules and should not be again: the upstream repos are 1.86 GB and 254 MB, the files read from them are 332 KB and 1.5 MB, and the submodules roughly tripled CI checkout time because a sparse checkout is local configuration that does not travel. Vendor a repo when a package reads the *repo*; commit the file when it reads one file.

## Empty checkouts

Fresh clones, CI runners and new worktrees start with an **empty** `.repos/` checkout — run `savvy repos sync` (or `repos_manage` action `sync`) once before relying on vendored content.

## Exclusions

The silk Biome preset excludes `**/.repos` centrally; markdownlint ignores it via `lib/configs/.markdownlint-cli2.jsonc`; dependabot excludes `.repos/**`; it was never a pnpm workspace, turbo or vitest target and still is not.

---

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the repo overview.*
