---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-06
last-synced: 2026-07-06
completeness: 75
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

## Roadmap (recorded, not built yet)

- `@effect/tsgo` language-service integration ([Effect-TS/tsgo](https://github.com/Effect-TS/tsgo)).
- `@effect/vitest` testing patterns.

Both currently have rough edges; expand when they mature.

## Known issues

The manifest at `plugin/.claude-plugin/plugin.json` exists but its `description` is leftover copy from vitest-agent and needs to be rewritten to describe this plugin.
