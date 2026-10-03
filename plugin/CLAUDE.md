# CLAUDE.md — the plugin workspace

This directory is `@effected/ai-plugin`, the single source of the "effected"
agent plugin. It is not an `@effected` library and never publishes to npm;
`pluginfinity` builds it into a Claude Code plugin and a GitHub Copilot plugin
that ship through the `spencerbeggs/bot` marketplaces.

**Concepts:** `okf/modules/ai-plugin.md`,
`okf/conventions/author-the-plugin-once.md`, `okf/conventions/skill-shape.md` —
Load when: changing a skill, an agent, a hook or `pluginfinity.config.ts`; they
cover the layout, the build, per-host translation, the skill catalog, the agent
roster and what the bats suite pins. Do not restate that material here.

**Releases:** `okf/decisions/ai-plugin-versions-both-builds.md`,
`okf/runbooks/release-a-plugin.md` — Load when: cutting a plugin version or
touching its `.changeset/config.json` entry.

**Construct index:** `okf/models/construct-annotations.md`,
`okf/conventions/construct-index-is-generated.md`,
`okf/conventions/evidence-ladder.md` — Load when: adding or annotating an
exported construct, or touching `scripts/generate-constructs.mts`,
`scripts/construct-annotations.json`, `scripts/check-construct-index.sh` or the
construct-index bats suites.

## Rules

- **`builds/` is generated and committed. Never hand-edit it.** Change the
  source (`skills/`, `agents/`, `hooks/`, `pluginfinity.config.ts`), run
  `pnpm build --filter @effected/ai-plugin` from the repo root, and commit
  source and builds together. `pnpm exec pluginfinity build --check` from here
  exits 1 when a build lags its source; the pre-push hook and CI's
  `pnpm plugin:check` gate both enforce it.
- **`build:dev` and `build:prod` are uncached on purpose** (`turbo.json`): a turbo cache hit would
  replay outputs over every file in `builds/`.
- **pluginfinity ships only `skills/`, `agents/` and `hooks/`, and ships all of
  `hooks/`.** Put tooling in `scripts/` and test fixtures under
  `__test__/fixtures/`, never under `hooks/`.
- **Express host differences in the source** with `targets.<host>` frontmatter,
  `<!-- pluginfinity:only <host> -->` blocks, or a per-target override in
  `pluginfinity.config.ts`. The `pluginfinity` skill (companion plugin
  `pluginfinity@spencerbeggs`) documents all three and every build finding.
- **Use relative links** between skill files; `pluginfinity://` links are
  refused for now.

## Tooling

- `pnpm test:bats` (repo root) runs `bats --recursive plugin/__test__`.
- `pnpm claude` / `pnpm copilot` (repo root) load `builds/claude` /
  `builds/copilot` from this checkout. Disable the marketplace copy first.
- `scripts/generate-constructs.mts` writes the construct index into
  `skills/effected-packages/references/constructs/`. Run it with bare `node`,
  then rebuild.

**The plugin carries no machinery for grading itself.** `.claude/skills/improve`
maintains `plugin/skills/` and `.claude/skills/constructs` maintains the
construct index; both are project-level skills, deliberately **outside** the
plugin. Keep them there.
