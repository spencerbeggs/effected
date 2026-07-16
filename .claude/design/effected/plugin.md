---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-16
last-synced: 2026-07-16
completeness: 90
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - releases.md
---

# The "effected" Claude Code plugin

## Overview

`plugin/` houses the "effected" Claude Code plugin for Effect v4 development. It ships a catalog of skills, three specialist subagents and a SessionStart briefing hook, and is dogfooded during package work (see [migration-playbook.md](migration-playbook.md)). It is [repo infrastructure, not an `@effected` library](architecture.md), and during dogfooding it is loaded via `claude --plugin-dir plugin` (the root `package.json` `claude` script).

The plugin's ethos is "verify against the installed beta, not v3 memory": every skill was authored from distillations where each API was probed against the installed `effect` beta pinned in the `effect` catalog. The corpus sources are the Effect team's migration notes (`Effect-TS/effect-smol/migration/*`), the official skill guides ([Effect-TS/skills](https://github.com/Effect-TS/skills)) and the shipped kit itself — `effected-packages` and `effect-v4-house-style` are distilled from the `@effected` packages. Our own lessons feed back in per step 6 of the playbook — `effect-v4-construct-map` (with its migration checklist) and `hardening-a-parser-port` are the distilled lessons, and the [`improve` skill](#the-improve-skill) is the mechanism that carries them.

## Skill catalog

Skills live under `plugin/skills/`, each a `SKILL.md` whose frontmatter `description` is the authoritative trigger. They group into five roles.

**Routing** — consulted first, so no one designs a capability that core or the kit already ships:

- `effect-v4-module-index` — the routing map for Effect v4 core: every core module in one table (what it is, when to reach for it, where it lives in the vendored source). Rows route; the other skills teach.
- `effected-packages` — the sibling routing map for the `@effected` kit: a compact table of all 18 packages (what it contains, when to reach for it, tier), plus a `references/<pkg>.md` per package covering entrypoints, core services with usage snippets, a testing-machinery section and gotchas. Module-index routes Effect core; effected-packages routes the kit. Preloaded by all three agents.

**Process/orchestration** — decides *what* to write:

- `effect-v4-planning` — the orchestration skill: it walks four design pillars (data types and errors, services and layers, observability, testability), then forces a compact design summary for buy-in before any implementation code exists. Handles greenfield (design forward from a required-slot template) and brownfield (audit existing code against the pillars into a gap table, each gap carrying a disposition — refactor-now, improve-incrementally or defer). On a port it defers to the playbook and `effect-v4-construct-map` for mechanics.

**Best-practice skills** — the idiomatic v4 way to write new code:

- `effect-v4-house-style` — the cross-cutting house style: module layout and the cycle firewall, naming, the typed-error taxonomy, TSDoc habits, layer conventions, test organization and observability posture. Distilled from a review panel over four representative kit packages (semver, toml, config-file, app). Preloaded by all three agents; `effect-v4-schema`'s `references/house-style.md` stays Schema-specific and the two cross-link.
- `effect-v4-schema` — the flagship Schema skill: house "do this, not this" rules plus worked patterns over Effect's canonical guide (split into `references/`).
- `effect-v4-services-layers` — `Context.Service` class form, Layer composition and the build-once memoization discipline.
- `effect-v4-idioms` — core Effect: typed errors and Result, generators, scope, forking, structural equality.
- `effect-v4-cli` — the v4 CLI story. `@effect/cli` is dead on the v4 line; the framework moved into core as `effect/unstable/cli`, with HTTP as `effect/unstable/http`. Carries the structural fact that decides a CLI package's tier — a runnable CLI needs `@effect/platform-node` and is therefore integrated tier — and the exit-code contract (a non-zero status comes only from a failed effect).
- `effect-v4-observability` — spans/logging/metrics, OTel composed at the app edge, the rule that pure-tier libraries instrument public fallible boundaries only.
- `effect-v4-testing` — `@effect/vitest`, `it.effect`, test layers, property tests and the false-green catalogue. Its mutation discipline lives in `references/mutation-testing.md`.

**The migration reference:**

- `effect-v4-construct-map` — the comprehensive v3→v4 lookup, split into a lean index plus per-domain tables in `references/`. Consulted before reaching for any v3 API name. Its `references/migration-checklist.md` is the ordered, greppable migration sweep — dependency moves → silent behavior changes → blocking removals → mechanical renames → domain restructures — distilled from the official migration notes plus the migration program's recorded scars.
- `effect-v4-source-lookup` — what to do when the construct-map is silent or the question is behavioural: the evidence ladder and the probe preconditions. Loaded by all three agents. See [the recorded coupling](#recorded-coupling-the-vendored-path).

**API-surface and hardening discipline:**

- `effect-api-extractor-bases` — the inline-factory plus scoped `_base` suppression idiom that yields a zero-warning API Extractor `issues.json` (a repo standard; see [effect-standards.md](effect-standards.md)).
- `hardening-a-parser-port` — depth guards, code-point/proto/C0 checks and the invariant that malformed input fails through the typed error channel, never as a defect.

## Specialist agents

Three subagents live under `plugin/agents/`, each arriving with the relevant skills preloaded via its frontmatter `skills` list. The delegation triggers are what the main agent dispatches on. All three preload `effected-packages` and `effect-v4-house-style`, verify at capability level — run the host repo's own gates, preferring structured session tools (vitest-agent MCP, Biome MCP) over hard-coded pnpm/turbo commands — and report `@effected` package improvement suggestions alongside skill rough edges.

- `effect-developer` — writes new idiomatic v4 code (schemas, services and layers, typed errors, CLIs); step 1 on any non-trivial feature is `effect-v4-planning`, emitting the design summary for buy-in before implementation. Delegate feature implementation here.
- `effect-reviewer` — reviews v4 code for idiom, error-channel and API-surface correctness, and writes or strengthens `@effect/vitest` tests. Delegate review and test authoring here.
- `effect-migrator` — migrates **any** Effect v3 codebase to v4, no longer scoped to `*-effect` → `@effected/*` ports. Two paths: a library port runs engine-first behind a characterization gate (when no compliance suite exists, characterization tests are written against v3 behavior before the port), and an in-place application migration runs dependency swap → silent-behavior audit → blocking removals resolved as recorded design decisions → compiler-driven mechanical tail. It detects the host repo's conventions (design docs, playbooks) instead of assuming this repo's. Delegate migration work here.

## The `improve` skill

`.claude/skills/improve` is a **project-level** skill, not a plugin skill. It is aware of `plugin/skills/` and edits them; the plugin carries no self-improvement machinery of its own. A tool does not grade itself, and the separation keeps the plugin publishable while the improvement loop stays free to assume this repo's layout.

It closes the loop the plugin's ethos implies: migrations falsify skill claims, and something has to turn those falsifications back into skill edits.

- **Harvest** runs at the end of a migration. It reads the retractions recorded in `.superpowers/sdd/progress.md` and the PR review threads, and files a ticket for each skill claim that turned out false, carrying the claim and the artifact that killed it.
- **Tune** runs against those open tickets. For each it climbs the evidence ladder, only as far as the claim requires, then amends the skill and closes the ticket citing what it found.

### The evidence ladder

The rungs are ordered by cost, and each answers a strictly different class of question:

1. **Migration notes and skill guides** (`effect-smol/migration/*.md`, `Effect-TS/skills` references). Cheap, and authoritative for the **rename** class.
2. **Source** — either the vendored `.repos/effect-smol` submodule (see [architecture.md](architecture.md#vendored-source)) or the installed `node_modules/effect/src`. Authoritative for **existence and signature**.
3. **A probe run from inside the package.** The only rung that settles **semantics**.

Rung 2 has two roots that can drift, so the skill names a tiebreak: **the installed source wins.** `node_modules` is what the code links against; the vendored tree is what someone pinned last, and it remains the only home of rung 1. Because the Effect catalogs pin exact betas and a re-pin is folded into the catalog-bump commit ([architecture.md](architecture.md#re-pinning-when-the-effect-catalog-bumps)), the installed version and the vendored tree agree by construction — but the tiebreak stays, because it costs nothing and catches the next divergence.

The docs are prescriptive rather than exhaustive, which is why rung 1 cannot be the last rung: `migration/services.md` migrates `Context.Tag` → `Context.Service` and never mentions `Context.Key`, yet `Context.Key` is the primitive some ports need. Nothing short of source settles a removal; nothing short of a probe settles behaviour. Hence the rule that keeps a skill edit non-vacuous: **an edit must cite the highest rung that actually settles its claim.** Renames may cite docs; existence claims must cite source; semantic claims must cite a runnable probe.

### Probe preconditions

Encoded as skill preconditions because each was learned by being burned:

- **Probes run from inside the package.** The workspace root resolves the v3 `effect` and reports the v3 surface without hesitation. Every probe prints its resolved `effect` version.
- **Probe files live at the package root.** The tsconfig `include` is `${configDir}/*.ts`, which does not match subdirectories — a probe in a subdirectory silently leaves the compilation program and false-passes its control.
- **The control assertion runs first.** A probe that cannot fail is worse than no probe.

### Recorded coupling: the vendored path

The plugin is loaded only from this repo (`claude --plugin-dir plugin`), so its agents and skills may assume the vendored tree exists — after `savvy repos sync`, since a submodule checkout starts empty in a fresh clone, CI runner or new git worktree (see [architecture.md](architecture.md#vendored-source)). Once published, that path is absent from a consumer's tree, and a skill that cannot find its evidence source must not fall back on v3 memory — silent fallback is the exact failure the plugin exists to prevent.

Two things contain it. The path is written `${CLAUDE_PROJECT_DIR}/.repos/effect-smol`, using [skill string substitution](https://code.claude.com/docs/en/skills.md): the probe protocol has agents `cd` into a package first, and a relative `.repos/effect-smol/...` would fail to resolve from there. And `effect-v4-source-lookup` runs a `test -d` preflight over each source root and **stops loudly** only when no usable root remains. `${CLAUDE_PROJECT_DIR}` resolves to the consuming project's root, which today is this repo and after publication will not be.

**Exit condition — met (verified 2026-07-16).** The skill's resolution block already implements the fallback ladder recorded here: an explicit `EFFECT_SMOL_SRC` override, then the vendored tree, then the installed `node_modules/effect/src` gated on a resolved v4 version (it *refuses* a v3 resolution rather than reporting it, and rung 3 still needs a probe), and a fatal stop only when every root is absent. Rung 1 (the migration notes) deliberately has no fallback — the npm package does not ship them — and the skill says so instead of degrading silently. What remains before end-user promotion is validation in a repo without the `.repos` config, not new machinery.

## SessionStart briefing hook

`plugin/hooks/hooks.json` registers a `SessionStart` hook (no matcher, so it fires on resume and compact too) that runs `session-start/orientation.sh`. The script briefs the main agent that the plugin ships these skills and three agents — the briefing catalogs every skill by name, describes the migrator as generic v3→v4 — and that it should delegate whole write/review/migrate Effect tasks to the matching agent rather than hand-rolling them inline. Its `dogfood_feedback` block carries two loops: plugin feedback (wrong or unhelpful skill/agent/hook guidance) and `@effected` package feedback (service gaps, fluency suggestions, candidate new constructs, services or packages, surfaced to the user); filing an issue still requires the user's explicit agreement. It is built on silk's hook pattern: `lib/hook-output.sh` provides the `emit_context` / `emit_noop` helpers, and the hook fails open (no-op) when `jq` is absent. The skill-roster bats test (`plugin/__test__/session-start-orientation.bats`) derives the expected skill list from the directories on disk with a minimum-count guard, so a new skill cannot ship without its briefing bullet.

## Distribution and release

The plugin manifest `plugin/.claude-plugin/plugin.json` names the plugin `effected`, and its `description` names the kit index, the house style and the migration checklist. Claude Code namespaces a plugin's skills and agents by plugin name, so references take the form `effected:effect-developer`. The stale-naming gap is closed: the genericization sweep fixed `orientation.sh`, both agent descriptions and the three hook fixtures, and the only "effective" left in `plugin/` is ordinary English in `effect-v4-testing`.

The plugin versions and releases with [`@effected/app`](packages/app.md): `.changeset/config.json` gives `@effected/app` an `additionalScopes` of `plugin/**` and a `versionFiles` entry (targeting `plugin/.claude-plugin/plugin.json`) that bumps the plugin manifest's `$.version` whenever app versions. So the plugin ships at `0.1.0` alongside the rest of the kit — on the release gate ([releases.md](releases.md)), not a package that releases on its own.

Distribution is through the maintainer's own Claude Code plugin marketplace, `spencerbeggs/bot`. The intended consumer install path is:

```sh
claude plugin marketplace add spencerbeggs/bot
claude plugin add spencerbeggs/effected --scope project
```

The plugin ships with `0.1.0` but is **not advertised to end users yet** — shipped but unannounced. It versions and publishes with the release; the maintainer is simply not ready to promote it.
