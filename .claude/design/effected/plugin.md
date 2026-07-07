---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-06
last-synced: 2026-07-06
completeness: 80
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
---

# The "effective" Claude Code plugin

## Overview

`plugin/` houses "effective", a Claude Code plugin for Effect development. It ships from the start with a small scope — skills plus an effect-dev subagent — and is dogfooded during the migrations described in [migration-playbook.md](migration-playbook.md). It is repo infrastructure, not an `@effected` library (see [architecture.md](architecture.md)).

## Skill sources

Skills are seeded from two places:

- Review of the Effect team's nascent skills library: [Effect-TS/skills](https://github.com/Effect-TS/skills).
- Our own migration lessons, distilled per step 6 of the playbook. The peer-closure discipline in [effect-standards.md](effect-standards.md) is early skill material.

## Shipped skills

The first three skills live under `plugin/skills/`, all distilled from the @effected/semver migration per playbook step 6:

- `effect-v4-construct-map` — v3→v4 construct mappings encountered during porting.
- `effect-v4-schema-classes` — `Schema.Class` domain-model patterns (checks, transformations, Equal/Hash customization).
- `effect-api-extractor-bases` — the named `@internal` `X_base` idiom for Effect class factories (now a repo standard; see [effect-standards.md](effect-standards.md)).

## Roadmap (recorded, not built yet)

- `@effect/tsgo` language-service integration ([Effect-TS/tsgo](https://github.com/Effect-TS/tsgo)).
- `@effect/vitest` testing patterns.

Both currently have rough edges; expand when they mature.
