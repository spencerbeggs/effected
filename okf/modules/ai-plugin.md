---
type: Module
title: ai-plugin
description: "The \"effected\" agent plugin: one pluginfinity source under plugin/ — skills, four specialist agents, a SessionStart briefing and a Claude-Code-only build-diagnostics monitor — built into committed Claude Code and GitHub Copilot plugins."
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
  by: "okfit/claude-code"
  at: 2026-11-09T20:42:55Z
integrity:
  generated:
    body: 5e2c8e8e320b499d
---

# ai-plugin

## Overview

`plugin/` is the workspace package `@effected/ai-plugins`, the single
source of the "effected" agent plugin: a catalog of skills, four
specialist subagents, a SessionStart briefing hook and, on Claude Code
only, one background monitor. It is dogfooded
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
  package.json             # @effected/ai-plugins (private, versioning only)
  pluginfinity.config.ts   # manifest fields, hooks, per-target overrides
  turbo.json               # build tasks uncached
  skills/ agents/ hooks/   # the source dirs pluginfinity ships
  monitors/                # build-diagnostics.mjs, shipped to the Claude build only
  bin/start-mcp.sh         # the effected-mcp launcher, copied into each build
  scripts/                 # construct-index generator, pre-push gate, anchor re-deriver (never shipped)
  __test__/                # bats suites and their fixtures
  builds/claude/           # GENERATED, committed
  builds/copilot/          # GENERATED, committed
```

pluginfinity ships `skills/`, `agents/` and all of `hooks/`, plus each
file a `monitors` entry's command names (`monitors/build-diagnostics.mjs`,
Claude Code only), so `scripts/` and `__test__/` sit beside the source
without reaching a user's install. A skill's own `skills/<name>/scripts/` is different: it
ships inside the skill. The reverse also holds: the whole `hooks/` directory
ships to both hosts, so test fixtures for the hook live under
`__test__/fixtures/hooks/`, not under `hooks/`.

## Building

`pnpm build --filter @effected/ai-plugins` runs `pluginfinity build`,
which rewrites both builds from the source. Its `build` task runs it, so a CI or release build regenerates `builds/`
before the release bumps the manifests. `plugin/turbo.json` sets the
task to `cache: false` with `builds/**` as their outputs, because a
turbo cache hit would replay outputs over every file in
`builds/`.[^turbo-json] Biome and markdownlint skip `plugin/builds/`.

`.github/workflows/silk-update.yml` lists `pluginfinity` among the
dependencies `silk-update-action` upgrades, so a new pluginfinity
release reaches `plugin/package.json` through the scheduled update PR.
That PR's `run` step does not build, so it changes only the manifest and
lockfile. When the new release changes what pluginfinity emits, the
committed builds go stale until someone runs
`pnpm build --filter @effected/ai-plugins` and commits the result; the
update PR's `plugin:check` gate fails until then.

From `plugin/`:

- `pnpm exec pluginfinity build --check` exits 1, writing nothing, when
  either committed build differs from what the source produces. The
  pre-push hook runs it on every push, and CI runs it through the root
  `pnpm plugin:check` script in release.yml's `on-build` gate, which
  also diffs `plugin/builds/` against the commit and fails on untracked
  or staged paths the diff cannot see.
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
- **One briefing, two response shapes.** The SessionStart hook is one
  script on both hosts, with no per-target override in
  `pluginfinity.config.ts`.[^pluginfinity-config] The pluginfinity hook
  library it sources writes each host's shape (nested
  `hookSpecificOutput` on Claude Code, a flat `additionalContext` on
  Copilot) and resolves the session's project: `CLAUDE_PROJECT_DIR` on
  Claude Code, the envelope's `cwd` walked up to its git root on
  Copilot, which has no project-root variable.
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
preloaded by the first three agents).

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
documents through `@effected/schemastore` and the `effected schema`
command of the effected tool — the config file (`defineSchemastore` from
`@effected/plugin`), the drift policy, document authoring, and the CI gate.

**Consumer upgrades**: `effected-renovate`, which is user-invoked only
(`disable-model-invocation: true`). It moves a consumer repository onto a
new kit release: bump the config dependencies, regenerate the lockfile,
confirm one `effect`, list the upgrade-ledger entries the upgrade
crossed together with their hits in the consumer's code, build, test,
align, write changesets and report. It is the first skill to ship
`scripts/`: three dependency-free `.mjs` helpers that `SKILL.md` names
through `{{skill_dir}}`. Its `references/ledger/` is the one
version-keyed plugin text. This repository writes the ledger through the
project-level `effect-upgrade` skill. See
[the ledger entry model](../models/renovate-ledger-entry.md) and
[the upgrade-ledger decision](../decisions/upgrade-ledger-in-the-plugin.md).

**Building a kit package and its TSDoc**: `building-a-package`, the
`effected package build` mechanics, `effected.toml` and the order to read
`dist/prod/issues.json` in (`buildOk` before any bucket); and
`authoring-tsdoc`, the release-tag policy, the supported tag allow-list, the
fix for each `ae-*` and `tsdoc-*` diagnostic and the suppression policy.
Both feed the `tsdoc-fixer` agent.

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

Four subagents live under `plugin/agents/` — `effect-developer.md`,
`effect-reviewer.md`, `action-engineer.md`, `tsdoc-fixer.md` — each
arriving with its relevant skills preloaded via frontmatter `skills`
lists. The first three preload `effected-packages` and `effect-v4-house-style`, verify at
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
- `tsdoc-fixer` — drives one package's `ae-*` and `tsdoc-*` diagnostics to
  zero, using `dist/prod/issues.json` from its own serial, fresh local
  build as the evidence. It preloads `authoring-tsdoc`,
  `effect-api-extractor-bases` and `building-a-package` and follows them
  exactly; it does not preload `effected-packages` or the house-style
  skill. Its contract is **source-only edits**: TSDoc comments, release
  tags and the export statements a diagnostic calls for. A `package.json`
  dependency, a `dtsExternals` or other `effected.toml` change, a new or
  widened `suppressWarnings` rule, a public-signature reshape made only to
  silence a diagnostic, a `@beta` or `@alpha` choice and a barrel
  refactor are recommendations in its report, never applied. It stops on
  one of four conditions: clean (`buildOk: true` and no `ae-*` or
  `tsdoc-*` entry), no progress (a rebuild leaves the same `(code, text)`
  set), out of its hands (every diagnostic left needs a recommended
  change) or a cap of five fix-and-rebuild rounds, and each ends with its
  step 7 report. It covers only packages built with `effected package
  build` and stops on any other toolchain.

## The build-diagnostics monitor

`plugin/monitors/build-diagnostics.mjs`, registered under `monitors` in
`pluginfinity.config.ts` as `build-diagnostics`, is a resident node
process on Claude Code only; the Copilot build drops it with a
monitor-omitted note, since Copilot has no monitors. It polls each
package's `dist/prod/issues.json` and prints one line per package once its
count of `ae-*` and `tsdoc-*` diagnostics settles at a non-zero value, so a
count still moving while an agent fixes diagnostics is held back. It
reports only an artifact it can vouch for: `buildOk` is true, the artifact
is at least as new as the package's `src/` sources and the
`effected.toml` files the build reads, and those inputs are clean in git.
A gate that fails produces silence, never a line. A lock keeps a second
monitor on the same project from reporting twice.

## What the bats suite pins

`pnpm test:bats` runs `bats --recursive plugin/__test__`. Every suite
pins a claim about the plugin's own completeness with an executable
check, never with prose a later edit can quietly falsify. The hook suite
runs the **builds**, the way each host runs them; every other suite
reads the source.

- `session-start-orientation.bats` — the briefing hook on both hosts
  through pluginfinity's `run_hook`, against `plugin/builds/`: each
  host's response shape, a briefing byte-identical across hosts, a skill
  and agent roster derived from the directories on disk, every
  vendored-source posture against the session's project, and the
  no-op cases. It reads the pin from the hook's one `EFFECT_PIN` line
  and checks it against `.repos/config.json` and the lockfile, so the
  pin is stated nowhere else. Build before running it.
- `agent-skill-registration.bats` — each agent's frontmatter `skills`
  list, including a membership test naming every Actions skill
  `action-engineer` must list, a membership test naming the three skills
  `tsdoc-fixer` must preload, a check that pins the specialist roster
  at exactly four, and a preload test per front-end skill confirming
  both Effect agents list it under `skills:`, not merely in the body.
- `monitor-build-diagnostics.bats` — the monitor, on the built script with
  `--once` plus the registered command through pluginfinity's
  `run_monitor`. Most cases assert silence: a crashed or unknown build, a
  zero count, an artifact older than a source or `effected.toml`, an
  uncommitted input, and an artifact under `node_modules` or `.repos`.
  The rest pin settling, the lock and its reclaim, and that Copilot ships
  no monitor. Build before running it.
- `construct-index.bats` and `construct-index-gate.bats` — the generator
  and the pre-push gate; see
  [construct-annotations](../models/construct-annotations.md).
- `effected-renovate.bats` — the `effected-renovate` scripts against
  fixture lockfiles and ledgers. It covers selection by crossing,
  ordering, `--check`, the chain fetch through a stub `gh` with
  `GH_HOST` scrubbed, and `bump-config-deps` renames. It also holds two
  repository gates: the shipped ledger is valid, and every pending
  breaking changeset is named by an entry. Its last case runs the
  **built** `applicable.mjs` on both hosts through pluginfinity's
  `run_script`. Build before running it.
- `effected-packages-index.bats` — the routing table against the
  workspace's published packages.
- `skill-anchors.bats` — every `File.ts:N` citation in every skill file
  pinned to its symbol in the vendored Effect tree or the kit source,
  through the manifest `__test__/helpers/skill-anchors.json` (scope
  `["."]`). It fails on an unlisted citation, a token occurring more or
  fewer times than its entry's `occurrences` (default 1), a token whose path
  is not its entry's `source`, a cited line off its symbol or on a comment
  line, a range end with no symbol, a bare `:NNN` that names no file, and a
  prose citation (`at 992`) beside a file named without a line. Its
  rederive fixtures pin `scripts/rederive-anchors.mjs`, which relocates
  anchors by symbol after a pin move, confines an `after`-guarded symbol to
  the block its `after` line opens, and refuses missing or ambiguous
  candidates and colliding rewrites; the two share one tokenizer,
  `scripts/skill-anchors-core.mjs`.

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

`pluginfinity.config.ts` registers one `SessionStart` hook for both
hosts, `hooks/session-start/orientation.sh`. It sources the hook library
pluginfinity writes into each build (`hooks/lib/pluginfinity/hook.sh`),
reports the vendored-source posture against `hook_session_dir`, and
emits through `hook_context`; the plugin vendors no hook helpers of its
own. `EFFECT_PIN` in that script is the plugin's only statement of the
kit's Effect pin. The briefing names the skills and agents the
plugin ships and tells the main agent to delegate whole write-or-review
Effect tasks to the matching agent rather than hand-rolling them inline.
Its `dogfood_feedback` block carries two loops — plugin feedback and
`@effected` package feedback — and filing an issue always requires the
user's explicit agreement.

## The effected MCP server

`pluginfinity.config.ts` declares one `mcpServers` entry, `effected`, for both hosts: `sh ${PLUGIN_ROOT}/bin/start-mcp.sh`. The launcher is a POSIX `sh` script on pluginfinity's server library. It runs the project's installed `effected-mcp` bin (from [`@effected/plugin`](plugin.md)), and when that is not installed it prints the `@effected/plugin` install line for the project's package manager on stderr and falls back to a one-off run of [`@effected/mcp`](mcp.md). The fallback exists because a one-off runner cannot choose between two bins of one package, so the front end carries the bin too ([shared bins](../decisions/carrier-only-declares-bins.md)). Nothing prints to stdout before the `exec`: stdout is the JSON-RPC wire. The server answers an `identity` tool and the `schema_check`, `schema_build` and `schema_validate` tools ([the schema commands](../interfaces/schema-commands.md) as data). `__test__/launchers.bats` runs the built launcher against a fake project with a stubbed bin on each host. The SessionStart briefing names the server.

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
    `"pluginfinity": "^0.3.0"` as its only devDependency.
[^claude-plugin-json]: `plugin/builds/claude/.claude-plugin/plugin.json` —
    `name: "effected"`.
[^turbo-json]: `plugin/turbo.json` — `build` has
    `cache: false` and `outputs: ["builds/**"]`.
[^pluginfinity-config]: `plugin/pluginfinity.config.ts` — `hooks.SessionStart`
    names `hooks/session-start/orientation.sh`, and `copilot: true`
    carries no override.
