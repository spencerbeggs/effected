---
type: Convention
title: Author the plugin once in plugin/, never edit its builds
description: Make every skill, agent and hook change in plugin/'s pluginfinity source and rebuild; plugin/builds/claude and plugin/builds/copilot are generated, committed output that is never hand-edited.
status: stable
stale_after: "2027-04-01T00:00:00Z"
tags:
  - dx
sources:
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: plugin-check
    resource: ../../package.json
  - id: check-construct-index-sh
    resource: ../../plugin/scripts/check-construct-index.sh
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-03T05:15:26Z
  body_sha256: cd5eacff4554fa86dc34a54171930464091637f0fba2c17dc7730235e67038b1
---

# Author the plugin once in plugin/, never edit its builds

The [ai-plugin](../modules/ai-plugin.md) has one source, `plugin/`'s
`skills/`, `agents/` and `hooks/`, and `pluginfinity` builds it into
both host plugins. Follow these rules:

1. **Change the source, then rebuild.** Edit under `plugin/skills/`,
   `plugin/agents/`, `plugin/hooks/` or `plugin/pluginfinity.config.ts`,
   then run `pnpm build --filter @effected/ai-plugin` and commit the
   source and the regenerated `plugin/builds/` together.
2. **Never hand-edit `plugin/builds/`.** The next build overwrites the
   edit. Before committing, confirm with
   `pnpm exec pluginfinity build --check` from `plugin/`, which exits 1
   when a build is out of step with its source.
3. **Express a host difference in the source, not in a build.** Use a
   `targets.<host>` frontmatter block, a
   `<!-- pluginfinity:only <host> -->` host block, or a per-target
   override in `pluginfinity.config.ts`.[^pluginfinity-config] The
   companion `pluginfinity` skill documents all three.
4. **Prove a change against the source.** The bats suites read
   `plugin/`, not a build. Load a build with `pnpm claude` or
   `pnpm copilot` to dogfood it.

Two gates enforce rule 2. The pre-push hook runs
`pluginfinity build --check` on every push outside CI, and CI's
validation phase runs `pnpm plugin:check` as release.yml's `on-build`
gate, which a `--no-verify` push cannot skip.[^plugin-check] That script
runs `pluginfinity build --check` and then
`git diff --exit-code -- plugin/builds`, because a validation build that
rewrote the builds in the runner would make `--check` alone pass
trivially. The construct-index gate also checks the builds after a
regeneration.[^check-construct-index-sh]

[^pluginfinity-config]: `plugin/pluginfinity.config.ts` — the `copilot`
    block overrides the SessionStart hook for that target only.
[^plugin-check]: `package.json` — the `plugin:check` script, chained onto
    `on-build` in `.github/workflows/release.yml`.
[^check-construct-index-sh]: `plugin/scripts/check-construct-index.sh` —
    check 3 runs `pluginfinity build --check`.
