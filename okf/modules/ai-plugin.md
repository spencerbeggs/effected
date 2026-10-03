---
type: Module
title: ai-plugin
description: "The \"effected\" agent plugin: one pluginfinity source under plugin/ — skills, three specialist agents and a SessionStart briefing — built into committed Claude Code and GitHub Copilot plugins."
status: stable
kind: plugin
resource: ../../plugin
tags:
  - architecture
  - dx
sources:
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: turbo-json
    resource: ../../plugin/turbo.json
  - id: claude-plugin-json
    resource: ../../plugin/builds/claude/.claude-plugin/plugin.json
  - id: pluginfinity-npm
    resource: "npm:pluginfinity"
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-03T05:15:26Z
  body_sha256: f539037470e6a60d0526db1f857c631b93dc283e96e571a28c45757e06e1bd9a
---

# ai-plugin

## Overview

`plugin/` is the workspace package `@effected/ai-plugin`, the single
source of the "effected" agent plugin: a catalog of skills, three
specialist subagents and a SessionStart briefing hook. It is dogfooded
during package work. `pluginfinity`, a devDependency from
npm,[^pluginfinity-npm] builds the one source into two host plugins:

- `plugin/builds/claude/`, the Claude Code plugin.
- `plugin/builds/copilot/`, the GitHub Copilot plugin.

Both builds are **committed** and are what the marketplaces install. See
[author the plugin once, never edit its builds](../conventions/author-the-plugin-once.md).

Both manifests name the plugin `effected`, so a skill or agent reference
takes the form `effected:effect-developer`.[^claude-plugin-json] Locally,
`pnpm claude` runs `claude --plugin-dir plugin/builds/claude`, and
`pnpm copilot` loads the Copilot build the same way.

The plugin's ethos is "verify against the installed release, not
memory": every skill is authored from claims probed against the `effect`
release the workspace lockfile resolves. Its corpus is the vendored
Effect source and its shipped notes, the official Effect-TS skill guides,
and the shipped kit itself.

The plugin carries no v3-to-v4 migration material, by decision rather
than gap: the kit is v4-native and the migration era is over. The
`v4-only` facts that a rename table happened to record — that there is
no `Either`, no `Context.Tag`, no `@effect/cli` package — survive as
positive statements of what v4 is, in the skill that owns the territory.
Reintroducing a migration skill or agent, or "X became Y" framing,
recreates the exact reasoning failure the SessionStart briefing exists
to prevent. Lessons from kit work feed back through
[the evidence-ladder convention](../conventions/evidence-ladder.md)'s
`improve` skill, which closes the loop.

## Layout

```text
plugin/
  package.json             # @effected/ai-plugin (private, versioning only)
  pluginfinity.config.ts   # manifest fields, hooks, per-target overrides
  turbo.json               # build tasks uncached
  skills/ agents/ hooks/   # the source — the only dirs pluginfinity ships
  scripts/                 # construct-index generator and pre-push gate
  __test__/                # bats suites and their fixtures
  builds/claude/           # GENERATED, committed
  builds/copilot/          # GENERATED, committed
```

pluginfinity ships nothing outside `skills/`, `agents/` and `hooks/`, so
`scripts/` and `__test__/` sit beside the source without reaching a
user's install. The reverse also holds: the whole `hooks/` directory
ships to both hosts, so test fixtures for the hook live under
`__test__/fixtures/hooks/`, not under `hooks/`.

## Building

`pnpm build --filter @effected/ai-plugin` runs `pluginfinity build`,
which rewrites both builds from the source. Both `build:dev` and
`build:prod` run it, so a CI or release build regenerates `builds/`
before the release bumps the manifests. `plugin/turbo.json` sets both
tasks to `cache: false` with `builds/**` as their outputs, because a
turbo cache hit would replay outputs over every file in
`builds/`.[^turbo-json] Biome and markdownlint skip `plugin/builds/`.

`.github/workflows/silk-update.yml` lists `pluginfinity` among the
dependencies `silk-update-action` upgrades, so a new pluginfinity
release reaches `plugin/package.json` through the scheduled update PR.
That PR's `run` step does not build, so it changes only the manifest and
lockfile. When the new release changes what pluginfinity emits, the
committed builds go stale until someone runs
`pnpm build --filter @effected/ai-plugin` and commits the result; the
update PR's `plugin:check` gate fails until then.

From `plugin/`:

- `pnpm exec pluginfinity build --check` exits 1, writing nothing, when
  either committed build differs from what the source produces. The
  pre-push hook runs it on every push, and CI runs it through the root
  `pnpm plugin:check` script in release.yml's `on-build` gate, which
  also diffs `plugin/builds/` against the commit.
- `pnpm exec pluginfinity validate` runs each host's validation over its
  build.

## Per-host translation

pluginfinity translates the source per host, so the source carries a
small amount of host-aware markup and nothing else:

- **Copilot description limit.** Copilot caps a skill's merged
  `description` and `when_to_use` at 1024 characters. Four skills
  exceed it and carry a `targets.copilot.description`:
  `building-schemastore-schemas`, `effect-v4-cli`, `effect-v4-testing`
  and `effected-packages`.
- **Host blocks.** `agents/action-engineer.md` and
  `agents/effect-reviewer.md` wrap their "preloaded skills" lines in
  `<!-- pluginfinity:only claude/copilot -->` host blocks.
- **The Copilot briefing.** Copilot gets its own SessionStart script,
  `hooks/session-start/orientation.copilot.sh`, registered as a
  per-target override in `pluginfinity.config.ts`.[^pluginfinity-config]
  Copilot exposes no project-root variable, so the script walks up from
  the envelope's `cwd`, and its output object is flat.
- **Copilot drops what it cannot express.** Claude model aliases and
  `xhigh`/`max` effort stay unresolved, `inherit` is dropped, and `Skill`
  is dropped from an agent's `tools`.

The `pluginfinity@spencerbeggs` companion plugin's `pluginfinity` skill
documents the config, frontmatter, `targets` blocks, host blocks, hooks
and every finding the build can report.

## Skill catalog

Skills live under `plugin/skills/`, each a `SKILL.md` whose frontmatter
`description` is the authoritative trigger. The directory listing is the
roster. The roles below are what a listing does not show:

**Routing** — consulted first so nobody designs a capability core or the
kit already ships: `effect-v4-module-index` (every core Effect v4 module
in one table) and `effected-packages` (one table row per `@effected`
package, per-package `references/`, and the generated construct index —
see [construct-annotations](../models/construct-annotations.md) —
preloaded by all three agents).

**Process** — decides what to write: `effect-v4-planning`, walking four
design pillars (data types and errors, services and layers,
observability, testability) before any implementation code exists.

**Best-practice skills**: `effect-v4-house-style`, `effect-v4-schema`,
`effect-v4-services-layers`, `effect-v4-idioms`, `effect-v4-cli`,
`effect-v4-mcp`, `effect-v4-observability`, `effect-v4-testing`.

**The evidence discipline**: `effect-v4-source-lookup`, the evidence
ladder and probe preconditions — see
[the evidence-ladder convention](../conventions/evidence-ladder.md).

**API-surface and hardening discipline**: `effect-api-extractor-bases`,
`hardening-a-parser-port`, `building-a-format-package`.

**Consumer adoption of a kit package**: `building-schemastore-schemas`,
teaching a consumer repository to publish SchemaStore-shaped JSON Schema
documents through `@effected/schemastore` and its CLI companion — the
config file, the drift policy, document authoring, and the CI gate.

**Architecture**: `design-patterns`, which indexes proven architecture
patterns as loadable references, starting with the carrier package
pattern for multi-bin tools.

**The actions suite** — the catalog's largest group and the teaching
surface for building a GitHub Action repository on the kit. Three entry
points divide cleanly and each names the other two rather than absorbing
them: `building-a-github-action` (which package owns a capability, plus
what the kit deliberately does not ship), `designing-an-action` (the
build order: recon, frozen spec, API dossier, contracts-first walking
skeleton, TDD fill), `structuring-an-action` (the shape the build
produces). `bootstrapping-an-action` is user-invoked only: an eight-
question interview that turns a fresh action-template copy into a plan
file and hands off to `action-engineer`. Behind those sit the
per-capability skills: `actions-runtime`, `actions-inputs-outputs`,
`actions-state-and-secrets`, `actions-cache-and-artifacts`,
`actions-reporting`, `github-api`, `github-app-tokens`,
`running-commands-and-tools`, `release-and-publish`,
`supply-chain-attestation`, `testing-actions`.

See [how a skill is shaped](../conventions/skill-shape.md) for the
authoring contract every one of these follows.

## Specialist agents

Three subagents live under `plugin/agents/` — `effect-developer.md`,
`effect-reviewer.md`, `action-engineer.md` — each arriving with its
relevant skills preloaded via frontmatter `skills` lists. All three
preload `effected-packages` and `effect-v4-house-style`, verify at
capability level by running the host repo's own gates (preferring
structured session tools over hard-coded pnpm/turbo commands), and
report `@effected` package improvement suggestions alongside skill rough
edges. Both Effect agents additionally preload `design-patterns`,
`effect-v4-cli` and `effect-v4-mcp` — the front-end skills, so a
dispatch to build or review a CLI or MCP server arrives with the
matching skill already loaded rather than reached for mid-task.

- `effect-developer` — writes new idiomatic v4 code, starting any
  non-trivial feature with `effect-v4-planning`'s design summary.
- `effect-reviewer` — reviews v4 code for idiom, error-channel and
  API-surface correctness, and writes or strengthens `@effect/vitest`
  tests.
- `action-engineer` — builds, extends, debugs and reviews GitHub
  Actions, release/publish pipelines and GitHub API programs; preloads
  the whole actions suite including `bootstrapping-an-action`.

## What the bats suite pins

`pnpm test:bats` runs `bats --recursive plugin/__test__`. Every suite
reads the **source**, not a build, on one shared principle: a claim
about the plugin's own completeness is pinned by an executable check,
never by prose a later edit can quietly falsify.

- `session-start-orientation.bats` and `copilot-session-start.bats` —
  the two briefing scripts: envelope shape, a skill and agent roster
  derived from the directories on disk, and the vendored-source posture.
- `agent-skill-registration.bats` — each agent's frontmatter `skills`
  list, including a membership test naming every Actions skill
  `action-engineer` must list, a check that pins the specialist roster
  at exactly three, and a preload test per front-end skill confirming
  both Effect agents list it under `skills:`, not merely in the body.
- `construct-index.bats` and `construct-index-gate.bats` — the generator
  and the pre-push gate; see
  [construct-annotations](../models/construct-annotations.md).
- `effected-packages-index.bats` — the routing table against the
  workspace's published packages.
- `skill-anchors.bats` — skill source anchors pinned to their symbols in
  the vendored Effect tree.

What no check pins is prose about the kit rather than about the plugin —
package counts, tier labels and publication status inside the
`effected-packages` routing map are exactly that class, and re-verifying
them belongs to a release wave, not a test.

## The construct index

One generated table per kit package, listing every exported construct
with an agent-authored intent column, so a capability can be found
without knowing its name. See
[construct-annotations](../models/construct-annotations.md) for the data
model and generator, and
[the construct index is generated](../conventions/construct-index-is-generated.md)
for the never-hand-edit rule.

## SessionStart briefing hook

`pluginfinity.config.ts` registers a `SessionStart` hook running
`hooks/session-start/orientation.sh`, which sources
`hooks/lib/hook-output.sh`; the copilot target overrides it with
`orientation.copilot.sh`. The briefing names the skills and agents the
plugin ships and tells the main agent to delegate whole write-or-review
Effect tasks to the matching agent rather than hand-rolling them inline.
Its `dogfood_feedback` block carries two loops — plugin feedback and
`@effected` package feedback — and filing an issue always requires the
user's explicit agreement.

## Versioning and distribution

One tracking package versions both builds — see
[one tracking package versions both plugin builds](../decisions/ai-plugin-versions-both-builds.md)
and [release a plugin](../runbooks/release-a-plugin.md).

Both builds ship from `spencerbeggs/bot`: the Claude Code build through
`.claude-plugin/marketplace.json`, the Copilot build through
`.github/plugin/marketplace.json`. Each entry is sha-pinned to an
effected commit and names a path inside it, which must be
`plugin/builds/claude` or `plugin/builds/copilot` respectively. The
plugin is published but not advertised: shipped, unannounced, and
promoted to end users only when the maintainer is ready.

[^pluginfinity-npm]: `npm:pluginfinity` — `plugin/package.json` declares
    `"pluginfinity": "^0.1.1"` as its only devDependency.
[^claude-plugin-json]: `plugin/builds/claude/.claude-plugin/plugin.json` —
    `name: "effected"`.
[^turbo-json]: `plugin/turbo.json` — `build:dev` and `build:prod` each
    have `cache: false` and `outputs: ["builds/**"]`.
[^pluginfinity-config]: `plugin/pluginfinity.config.ts` — the `copilot`
    block's `hooks.SessionStart` names `orientation.copilot.sh`.
