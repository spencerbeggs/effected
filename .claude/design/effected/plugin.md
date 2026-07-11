---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-10
last-synced: 2026-07-10
completeness: 92
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - releases.md
---

# The "effective" Claude Code plugin

## Overview

`plugin/` houses "effective", a Claude Code plugin for Effect v4 development. It ships a catalog of skills, three specialist subagents and a SessionStart briefing hook, and is dogfooded during the migrations described in [migration-playbook.md](migration-playbook.md). It is repo infrastructure, not an `@effected` library (see [architecture.md](architecture.md)). During dogfooding it is loaded via `claude --plugin-dir plugin` — the root `package.json` `claude` script.

The plugin's ethos is "verify against the installed beta, not v3 memory": every skill was authored from distillations where each API was probed against the installed `effect` beta pinned in the `effect` catalog. The corpus sources were the Effect team's migration notes (`Effect-TS/effect-smol/migration/*`) and the official skill guides ([Effect-TS/skills](https://github.com/Effect-TS/skills)). Our own migration lessons feed back in per step 6 of the playbook — `effect-v4-construct-map` and `hardening-a-parser-port` are the flywheel's distilled lessons, and the [`improve` skill](#the-improve-skill) is the mechanism that carries them.

## Skill catalog

Skills live under `plugin/skills/`, each a `SKILL.md` whose frontmatter `description` is the authoritative trigger. They group into four roles.

**Process/orchestration** — runs before the others and decides *what* to write:

- `effect-v4-planning` — the orchestration skill: it walks four design pillars (data types and errors, services and layers, observability, testability), then forces a compact "design summary" for buy-in before any implementation code exists. Handles greenfield (design forward from a required-slot template) and brownfield (audit existing code against the pillars into a gap table, each gap carrying a recommended disposition — refactor-now, improve-incrementally or defer). It orchestrates the detailed skills below rather than restating them; on a port it defers to the playbook and `effect-v4-construct-map` for mechanics and contributes only the forward-design lenses.

**Best-practice skills** — the idiomatic v4 way for writing new code:

- `effect-v4-schema` — the flagship Schema skill: house "do this, not this" rules + worked patterns (Class-vs-Struct, optionality, checks/refine/makeFilter, codecs, `FromString` statics, make-vs-new, brand/Opaque, custom Equal/Hash) in `references/house-style.md`, over Effect's canonical guide split into `references/`.
- `effect-v4-services-layers` — `Context.Service` class form, Layer composition and the build-once memoization discipline.
- `effect-v4-idioms` — core Effect: typed errors and Result, generators, scope, forking, structural equality.
- `effect-v4-observability` — spans/logging/metrics, OTel composed at the app edge, the house rule that pure-tier libraries instrument public fallible boundaries only.
- `effect-v4-testing` — `@effect/vitest`, `it.effect`, test layers, property tests.

**The migration reference:**

- `effect-v4-construct-map` — the comprehensive v3→v4 lookup, per-domain rename/restructure tables. Consulted before reaching for any v3 API name.
- `effect-v4-source-lookup` — what to do when the construct-map is silent or the question is behavioural: the evidence ladder and the probe preconditions. Loaded by all three agents. See [the recorded coupling](#recorded-coupling-the-vendored-path).

**API-surface and hardening discipline:**

- `effect-api-extractor-bases` — the inline-factory + scoped `_base` suppression idiom that yields a zero-warning API Extractor `issues.json` (now a repo standard; see [effect-standards.md](effect-standards.md)).
- `hardening-a-parser-port` — depth guards, code-point/proto/C0 checks and the invariant that malformed input fails through the typed error channel, never as a defect.

## Specialist agents

Three subagents live under `plugin/agents/`, each arriving with the relevant skills preloaded via its frontmatter `skills` list. The delegation triggers below are what the main agent dispatches on.

- `effect-developer` — writes new idiomatic v4 code (schemas, services and layers, typed errors, CLIs); step 1 on any non-trivial feature is `effect-v4-planning` — emit the design summary for buy-in before implementation. Skills: planning, schema-classes, services-layers, idioms, observability, api-extractor-bases. Delegate feature implementation here.
- `effect-reviewer` — reviews v4 code for idiom, error-channel and API-surface correctness, and writes or strengthens `@effect/vitest` tests. Skills: testing, idioms, schema-classes, services-layers, observability, hardening, api-extractor-bases. Delegate review and test authoring here.
- `effect-migrator` — drives v3→v4 ports engine-first behind a compliance gate; after reading the design doc it runs the `effect-v4-planning` pillars over the *target* v4 shape for the forward-design lenses (error audiences, observability posture, testability), deferring to the migration playbook and construct-map for port mechanics (migration order, the compliance gate, v3→v4 name lookups). Skills: construct-map and planning plus every best-practice skill, hardening and api-extractor-bases. Delegate migration work here; this agent drives the next port per the playbook.

## The `improve` skill

`.claude/skills/improve` is a **project-level** skill, not a plugin skill. It is aware of `plugin/skills/` and edits them; the plugin carries no self-improvement machinery of its own. A tool does not grade itself, and the separation keeps the plugin publishable while the improvement loop stays free to assume this repo's layout.

It closes the loop the plugin's ethos already implies: migrations falsify skill claims, and something has to turn those falsifications back into skill edits.

**Harvest** runs at the end of a migration. It reads the retractions recorded in `.superpowers/sdd/progress.md` and the PR review threads, and files a ticket for each skill claim that turned out false, carrying the claim and the artifact that killed it. This is what produced issues #9–#12 on `spencerbeggs/effected` by hand during the `config-file` cycle — two against `hardening-a-parser-port`, one each against `effect-v4-testing` and `effect-v4-observability`.

**Tune** runs against those open tickets. For each it climbs an evidence ladder, only as far as the claim requires, then amends the skill and closes the ticket citing what it found.

### The evidence ladder

The rungs are ordered by cost, and each answers a strictly different class of question. The ordering was established empirically on 2026-07-09 by testing the corpus against facts this repo had already won by probing.

1. **Migration notes and skill guides** (`effect-smol/migration/*.md`, `Effect-TS/skills` references). Cheap, and authoritative for the **rename** class. `migration/forking.md` names `Effect.fork` → `Effect.forkChild` in a table; `migration/cause.md` gives `Cause.isFailure` → `Cause.hasFails`.
2. **Source** — either the vendored `repos/effect-smol` subtree (see [architecture.md](architecture.md#vendored-source)) or the installed `node_modules/effect/src`. Authoritative for **existence and signature**.
3. **A probe run from inside the package.** The only rung that settles **semantics**.

Rung 2 has two roots and they drift, so the skill names a tiebreak: **the installed source wins.** The subtree is a `git subtree` pinned to an exact tag, while the catalog entry is a *caret* range (`^4.0.0-beta.94`), so pnpm floats forward to the newest beta and the tree does not follow until someone re-pins it. During the `store` migration the tree sat at beta.94 against an installed beta.97 — a stale rung-2 answer is delivered with total confidence and no error, which is exactly the failure mode the ladder exists to prevent. `node_modules` is what the code links against; the subtree is what someone vendored last, and it remains the only home of rung 1.

The docs are prescriptive rather than exhaustive, which is why rung 1 cannot be the last rung. `migration/services.md` migrates `Context.Tag` → `Context.Service` and never mentions `Context.Key` at all — yet `Context.Key` is the primitive the port needed, and its `out Shape` covariance is what sank a design that had already been approved. `migration/forking.md` never mentions that `Effect.makeSemaphore` is gone and `Semaphore` is now a top-level module. `migration/cause.md` never mentions `Exit.causeOption` → `Exit.getCause`. Nothing short of source settles a removal; nothing short of a probe settles behaviour like `Effect.cached` memoizing an interrupt `Exit`.

Hence the rule that keeps a skill edit non-vacuous: **an edit must cite the highest rung that actually settles its claim.** Renames may cite docs. Existence claims must cite source. Semantic claims must cite a runnable probe. Citing a doc passage for a semantic claim is how these skills acquired their errors in the first place — the v3 docs confirm the v3 semantics, confidently.

### Probe preconditions

Encoded as skill preconditions because each was learned by being burned:

- **Probes run from inside the package.** The workspace root resolves `effect@3.21.4` and reports the v3 surface without hesitation. Every probe prints its resolved `effect` version.
- **Probe files live at the package root.** The tsconfig `include` is `${configDir}/*.ts`, which does not match subdirectories — a probe in a subdirectory silently leaves the compilation program and false-passes its control.
- **The control assertion runs first.** A probe that cannot fail is worse than no probe.

### Recorded coupling: the vendored path

The plugin is currently loaded only from this repo (`claude --plugin-dir plugin`), so its agents and skills may assume the vendored tree exists. Once published, that path is absent from a consumer's tree — and a skill that cannot find its evidence source does not stop, it falls back on v3 memory, which is the exact failure the plugin exists to prevent. Silent fallback is worse than a hard error, because it is indistinguishable from success.

Two things contain it. **Exactly one file in `plugin/` names the path**: `plugin/skills/effect-v4-source-lookup/SKILL.md`. The three agents load that skill and reference the ladder, never the directory — one file to genericize rather than four, and the invariant is checkable (`grep -rl 'repos/effect-smol' plugin/ | wc -l` is 1).

And the path is written `${CLAUDE_PROJECT_DIR}/repos/effect-smol`, using [skill string substitution](https://code.claude.com/docs/en/skills.md) (Claude Code ≥ 2.1.196). This is not cosmetic: the probe protocol has agents `cd` into a package before running anything, and a relative `repos/effect-smol/...` silently fails to resolve from there. The substitution also makes the guard trivial — the skill runs a `test -d` preflight and **stops loudly** when the tree is missing.

`${CLAUDE_PROJECT_DIR}` resolves to the *consuming project's* root, which today is this repo and after publication will not be. So the loud failure is already correct; what remains is the fallback chain.

**Exit condition, owned by `improve`:** before publication, `effect-v4-source-lookup` gains fallbacks ahead of its hard failure — an explicit override, then the installed `.d.ts` under `node_modules/effect` (version-exact, settles existence and signature, no implementations, so rung 3 still needs a probe) — and only then fails.

### `effect-v4-source-lookup`

The rung-2/rung-3 skill, loaded by all three agents. It carries the ladder, the probe preconditions, and the worked example that shows the rungs disagreeing: `migration/services.md` never mentions `Context.Key`; a runtime `typeof Context.Key` reports `undefined` because it is type-only; and `Context.ts:65` declares `export interface Key<out Identifier, out Shape>`, giving existence, type-only-ness and the covariance that sank an approved design — all three facts available only at rung 2.

Its addition corrected a live trap in `effect-developer`, whose "prime directive" prescribed `node -e "console.log(typeof S.TheThing)"` as the existence probe. That check reports `undefined` for every type-only symbol in v4, so the agent's own verification ritual was a false-negative generator.

## SessionStart briefing hook

`plugin/hooks/hooks.json` registers a `SessionStart` hook (no matcher, so it fires on resume and compact too) that runs `session-start/orientation.sh`. The script briefs the main agent that the plugin ships these skills and three agents, and that it should delegate whole write/review/migrate Effect tasks to the matching agent rather than hand-rolling them inline. It is built on silk's hook pattern: `lib/hook-output.sh` provides the `emit_context` / `emit_noop` helpers that emit the `hookSpecificOutput` JSON, and the hook fails open (no-op) when `jq` is absent. See `session-start/orientation.sh` for the briefing text.
