# CLAUDE.md — the plugins workspace

This directory holds the repo's **two agent plugins**. Neither is an `@effected`
library and neither publishes to npm; both are repo infrastructure that ships to
users through the `spencerbeggs/bot` marketplaces.

**Design doc:** `@../.claude/design/effected/plugin.md` — Load when: changing a
skill, an agent, the hooks or the construct index; it owns the skill catalog, the
agent roster, the skill shape contract and what the bats suite pins. Do not
restate that material here.

## Layout

- `claude-code/` — "effected", the Claude Code plugin: `skills/`, `agents/`,
  `hooks/`, `scripts/`, `__test__/`. Manifest at
  `claude-code/.claude-plugin/plugin.json` (plugin name `effected`).
- `copilot/` — a **new and experimental** GitHub Copilot plugin, currently a
  stub: empty `agents/`, `skills/`, `hooks/` plus a root `hooks.json`. Its
  manifest is `copilot/plugin.json` — at the **directory root**, not under a dot
  directory. Claude Code reads `.claude-plugin/plugin.json`; Copilot does not.
  Do not "repair" that asymmetry.

## Claude Code first, then port

Claude Code and Copilot have similar but different `SKILL.md` and hook formats,
so agent and skill content is maintained in **two versions**. The team works
almost entirely in Claude Code.

**Change `claude-code/` first, then copy and refactor into `copilot/`.**
`claude-code/` is the source of truth; `copilot/` is a downstream port and an
experiment. Never author content in `copilot/` and back-port it.

## Versioning: private tracking packages

Each plugin owns a private workspace package whose only job is giving changesets
something to version. `pnpm-workspace.yaml` includes `plugins/*`, so both are
real workspace members.

- `plugins/claude-code/package.json` → `@effected/claude-code-plugin`
- `plugins/copilot/package.json` → `@effected/copilot-plugin`

Both are `"private": true` with **no `publishConfig`** — unlike a source package,
where `private` is a build-time detail, here it is the whole point.

**The Claude Code plugin no longer tracks `@effected/app`'s version.** Write a
changeset naming `@effected/claude-code-plugin` or `@effected/copilot-plugin`
directly; a changeset for any other package does nothing for a plugin.

`.changeset/config.json` sets `privatePackages: { tag: true, version: true }` and
maps each tracking package to its manifest through `@savvy-web/changelog`
`versionFiles` — `@effected/claude-code-plugin` →
`plugins/claude-code/.claude-plugin/plugin.json` at `$.version`,
`@effected/copilot-plugin` → `plugins/copilot/plugin.json` at `$.version`. CI
therefore bumps `package.json` and the plugin manifest together, then cuts a git
tag and a GitHub release (`@effected/copilot-plugin@0.1.0`) with **no npm
publish**.

**In flight, not permanent:** `silk-release-action` supports this
GitHub-release-only flow but has not been exercised in a while, so
`.github/workflows/release.yml` is pinned to the `@dev` ref of
`spencerbeggs/.github/.github/workflows/release.yml` while the user shakes it
out. Do not treat that pin as settled convention.

## Distribution

Both ship from `spencerbeggs/bot`, through two separate marketplace manifests
whose automation differs:

- **Claude Code** — `bot/.claude-plugin/marketplace.json`, entry `effected`,
  `git-subdir` source, `path: plugins/claude-code`, sha-pinned and bumped
  **automatically** on release.
- **Copilot** — `bot/.github/plugin/marketplace.json`, entry `effected`,
  `github` source, `repo: spencerbeggs/effected`,
  `path: plugins/copilot`, `ref: ""`. Bumped **by hand** for the initial
  versions; there is no automation yet.

## Tooling

- `pnpm test:bats` runs `bats --recursive plugins` — the suites live in
  `claude-code/__test__/`.
- The root `claude` script loads the plugin locally:
  `claude --plugin-dir plugins/claude-code --plugin-dir=../../savvy-web/systems/plugins/silk`.
- `claude-code/scripts/generate-constructs.mts` generates the construct index
  into `claude-code/skills/effected-packages/references/constructs/`. Run it with
  bare `node`; never hand-edit the generated output.

**The plugin carries no machinery for grading itself.** `.claude/skills/improve`
maintains `plugins/claude-code/skills/` and `.claude/skills/constructs` maintains
the construct index — both are project-level skills, deliberately **outside** the
plugin. Keep them there.
