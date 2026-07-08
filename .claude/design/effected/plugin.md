---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-07
last-synced: 2026-07-07
completeness: 90
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
---

# The "effective" Claude Code plugin

## Overview

`plugin/` houses "effective", a Claude Code plugin for Effect v4 development. It ships a catalog of skills, three specialist subagents and a SessionStart briefing hook, and is dogfooded during the migrations described in [migration-playbook.md](migration-playbook.md). It is repo infrastructure, not an `@effected` library (see [architecture.md](architecture.md)). During dogfooding it is loaded via `claude --plugin-dir plugin` — the root `package.json` `claude` script.

The plugin's ethos is "verify against the installed beta, not v3 memory": every skill was authored from distillations where each API was probed against the installed `effect@4.0.0-beta.93`. The corpus sources were the Effect team's migration notes (`Effect-TS/effect-smol/migration/*`) and the official skill guides ([Effect-TS/skills](https://github.com/Effect-TS/skills)). Our own migration lessons feed back in per step 6 of the playbook — `effect-v4-construct-map` and `hardening-a-parser-port` are the flywheel's distilled lessons.

## Skill catalog

Skills live under `plugin/skills/`, each a `SKILL.md` whose frontmatter `description` is the authoritative trigger. They group into three roles.

**Best-practice skills** — the idiomatic v4 way for writing new code:

- `effect-v4-schema-classes` — the flagship Schema domain-model skill: Class-vs-Struct, optionality, checks/refine/makeFilter, codecs, `FromString` statics, make-vs-new, brand/Opaque, custom Equal/Hash.
- `effect-v4-services-layers` — `Context.Service` class form, Layer composition and the build-once memoization discipline.
- `effect-v4-idioms` — core Effect: typed errors and Result, generators, scope, forking, structural equality.
- `effect-v4-observability` — spans/logging/metrics, OTel composed at the app edge, the house rule that pure-tier libraries instrument public fallible boundaries only.
- `effect-v4-testing` — `@effect/vitest`, `it.effect`, test layers, property tests.

**The migration reference:**

- `effect-v4-construct-map` — the comprehensive v3→v4 lookup, per-domain rename/restructure tables. Consulted before reaching for any v3 API name.

**API-surface and hardening discipline:**

- `effect-api-extractor-bases` — the `@public X_base` idiom that yields a zero-warning API Extractor `issues.json` (now a repo standard; see [effect-standards.md](effect-standards.md)).
- `hardening-a-parser-port` — depth guards, code-point/proto/C0 checks and the invariant that malformed input fails through the typed error channel, never as a defect.

## Specialist agents

Three subagents live under `plugin/agents/`, each arriving with the relevant skills preloaded via its frontmatter `skills` list. The delegation triggers below are what the main agent dispatches on.

- `effect-developer` — writes new idiomatic v4 code (schemas, services and layers, typed errors, CLIs). Skills: schema-classes, services-layers, idioms, observability, api-extractor-bases. Delegate feature implementation here.
- `effect-reviewer` — reviews v4 code for idiom, error-channel and API-surface correctness, and writes or strengthens `@effect/vitest` tests. Skills: testing, idioms, schema-classes, services-layers, observability, hardening, api-extractor-bases. Delegate review and test authoring here.
- `effect-migrator` — drives v3→v4 ports engine-first behind a compliance gate. Skills: construct-map plus every best-practice skill, hardening and api-extractor-bases. Delegate migration work here; this agent drives the next port per the playbook.

## SessionStart briefing hook

`plugin/hooks/hooks.json` registers a `SessionStart` hook (no matcher, so it fires on resume and compact too) that runs `session-start/orientation.sh`. The script briefs the main agent that the plugin ships these skills and three agents, and that it should delegate whole write/review/migrate Effect tasks to the matching agent rather than hand-rolling them inline. It is built on silk's hook pattern: `lib/hook-output.sh` provides the `emit_context` / `emit_noop` helpers that emit the `hookSpecificOutput` JSON, and the hook fails open (no-op) when `jq` is absent. See `session-start/orientation.sh` for the briefing text.
