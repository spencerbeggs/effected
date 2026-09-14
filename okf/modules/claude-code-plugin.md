---
type: Module
title: claude-code-plugin
description: "The \"effected\" Claude Code plugin: skills, three specialist agents and a SessionStart briefing hook, dogfooded during package work and the source of truth for skill and agent content."
status: stable
kind: plugin
resource: ../../plugins/claude-code
tags:
  - architecture
  - dx
sources:
  - id: plugin-json
    resource: ../../plugins/claude-code/.claude-plugin/plugin.json
  - id: package-json
    resource: ../../plugins/claude-code/package.json
  - id: plugins-claude-md
    resource: ../../plugins/CLAUDE.md
generated:
  by: "claude-code/opus-5"
  at: 2026-09-14T04:45:45Z
  body_sha256: 2d2e07e0f2b7dbd7b40ca70b78f8ff59877edecd6d5750a20fe9e1e3453f1776
---

# claude-code-plugin

## Overview

`plugins/claude-code/` is the "effected" Claude Code plugin: a catalog of
skills, three specialist subagents and a SessionStart briefing hook. It
is dogfooded during package work and is **the source of truth** for all
skill and agent content — [copilot-plugin](copilot-plugin.md) is a
downstream port that trails it, never the other way around (see
[Claude Code first, then port](../conventions/plugin-claude-code-first.md)).
During dogfooding it is loaded via `claude --plugin-dir plugins/claude-code`.
The Claude Code manifest names the plugin `effected`, so a skill or agent
reference takes the form `effected:effect-developer`.[^plugin-json]

The plugin's ethos is "verify against the installed prerelease, not
memory": every skill is authored from claims probed against the `effect`
prerelease the workspace catalog pins. Its corpus is the vendored Effect
source and its shipped notes, the official Effect-TS skill guides, and
the shipped kit itself.

The plugin carries no v3-to-v4 migration material, by decision rather
than gap: the kit is v4-native and the migration era is over. The
`v4-only` facts that a rename table happened to record — that there is
no `Either`, no `Context.Tag`, no `@effect/cli` package — survive as
positive statements of what v4 is, in the skill that owns the territory.
Reintroducing a migration skill or agent, or "X became Y" framing,
recreates the exact reasoning failure the SessionStart briefing exists to
prevent. Lessons from kit work feed back through
[the evidence-ladder convention](../conventions/evidence-ladder.md)'s
`improve` skill, which closes the loop.

## Layout

```text
plugins/claude-code/
  .claude-plugin/plugin.json   # manifest, under a dot-directory
  package.json                 # @effected/claude-code-plugin (private, versioning only)
  skills/ agents/ hooks/ scripts/ __test__/
```

Claude Code reads `.claude-plugin/plugin.json`; the manifest location
differs from Copilot's plugin-root placement by upstream's own choice,
not an inconsistency to repair.

## Skill catalog

Skills live under `plugins/claude-code/skills/`, each a `SKILL.md` whose
frontmatter `description` is the authoritative trigger. On disk today:

`actions-cache-and-artifacts`, `actions-inputs-outputs`,
`actions-reporting`, `actions-runtime`, `actions-state-and-secrets`,
`bootstrapping-an-action`, `building-a-format-package`,
`building-a-github-action`, `building-schemastore-schemas`,
`designing-an-action`,
`effect-api-extractor-bases`, `effect-v4-cli`, `effect-v4-house-style`,
`effect-v4-idioms`, `effect-v4-module-index`, `effect-v4-observability`,
`effect-v4-planning`, `effect-v4-schema`, `effect-v4-services-layers`,
`effect-v4-source-lookup`, `effect-v4-testing`, `effected-packages`,
`github-api`, `github-app-tokens`, `hardening-a-parser-port`,
`release-and-publish`, `running-commands-and-tools`,
`structuring-an-action`, `supply-chain-attestation`, `testing-actions`.

The directory listing is the roster; the roles below are what a
directory listing does not show:

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
`effect-v4-observability`, `effect-v4-testing`.

**The evidence discipline**: `effect-v4-source-lookup`, the evidence
ladder and probe preconditions — see
[the evidence-ladder convention](../conventions/evidence-ladder.md).

**API-surface and hardening discipline**: `effect-api-extractor-bases`,
`hardening-a-parser-port`, `building-a-format-package`.

**Consumer adoption of a kit package**: `building-schemastore-schemas`,
teaching a consumer repository to publish SchemaStore-shaped JSON Schema
documents through `@effected/schemastore` and its CLI companion — the
config file, the drift policy, document authoring, and the CI gate.

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

Three subagents live under `plugins/claude-code/agents/` —
`effect-developer.md`, `effect-reviewer.md`, `action-engineer.md` — each
arriving with its relevant skills preloaded via frontmatter `skills`
lists. All three preload `effected-packages` and `effect-v4-house-style`,
verify at capability level by running the host repo's own gates
(preferring structured session tools over hard-coded pnpm/turbo
commands), and report `@effected` package improvement suggestions
alongside skill rough edges.

- `effect-developer` — writes new idiomatic v4 code, starting any
  non-trivial feature with `effect-v4-planning`'s design summary.
- `effect-reviewer` — reviews v4 code for idiom, error-channel and
  API-surface correctness, and writes or strengthens `@effect/vitest`
  tests.
- `action-engineer` — builds, extends, debugs and reviews GitHub Actions,
  release/publish pipelines and GitHub API programs; preloads the whole
  actions suite including `bootstrapping-an-action`.

## What the bats suite pins

Three `.bats` files under `plugins/claude-code/__test__/` hold the
plugin's structural claims on one shared principle: a claim about the
plugin's own completeness is pinned by an executable check, never by
prose a later edit can quietly falsify.

- `session-start-orientation.bats` — the skill roster in the briefing
  hook, derived from the directories on disk with a minimum-count guard.
- `agent-skill-registration.bats` — each agent's frontmatter `skills`
  list, including a membership test naming every Actions skill
  `action-engineer` must list, and a check that pins the specialist
  roster at exactly three so a retired migrator agent cannot quietly
  return.
- `construct-index.bats` — the executable pin on the construct index:
  generator fixture tests, a drift test that regenerates the committed
  index into a temp dir and diffs, and the strict annotation gate.

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

`plugins/claude-code/hooks/hooks.json` registers a `SessionStart` hook
(no matcher, so it fires on resume and compact too) that runs
`session-start/orientation.sh`. The script briefs the main agent on the
skills and agents the plugin ships and tells it to delegate whole
write-or-review Effect tasks to the matching agent rather than
hand-rolling them inline. Its `dogfood_feedback` block carries two loops
— plugin feedback and `@effected` package feedback — and filing an issue
always requires the user's explicit agreement.

## Distribution

Ships from `spencerbeggs/bot`'s `.claude-plugin/marketplace.json`, a
`git-subdir` source pointed at `plugins/claude-code`, sha-pinned and
bumped automatically on release. See
[plugins version via private tracking packages](../decisions/plugins-version-via-private-tracking-packages.md)
for how a release is cut, and
[release a plugin](../runbooks/release-a-plugin.md) for the procedure.
It is published but not advertised: shipped, unannounced, and promoted
to end users only when the maintainer is ready.

Installing it:

```sh
claude plugin marketplace add spencerbeggs/bot
claude plugin add spencerbeggs/effected --scope project
```

[^plugin-json]: `plugins/claude-code/.claude-plugin/plugin.json` —
    `name: "effected"`.
