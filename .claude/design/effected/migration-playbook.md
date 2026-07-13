---
status: current
module: effected
category: meta
created: 2026-07-06
updated: 2026-07-12
last-synced: 2026-07-12
completeness: 80
related:
  - architecture.md
  - effect-standards.md
  - package-inventory.md
  - package-setup.md
  - plugin.md
---

# Migration playbook

## Overview

The per-package flywheel for moving a v3 `*-effect` repo into this monorepo. Each migration is a redesign against Effect v4, not a lift-and-shift (see [architecture.md](architecture.md)). Per-package design docs are created when that package's migration begins, not before.

## Steps per package

1. **Analyze** the v3 source repo — API surface, dependencies, IO boundaries. Initial reviews for all ten repos already exist in `.claude/reviews/`; each migration's analysis step starts from that package's report.
2. **Design** — write the package's design doc with its target class-based API and tier per [effect-standards.md](effect-standards.md); the target module layout follows its module-per-concept structure.
3. **Port/redesign** to Effect v4.
4. **Test** with `@effect/vitest` (v4 beta; reference implementation: [effect-smol packages/vitest](https://github.com/Effect-TS/effect-smol/tree/main/packages/vitest)) using the `__test__/` conventions in the root `CLAUDE.md` Testing section and the sibling suites (no standalone `__test__/CLAUDE.md` exists).
5. **Document** — wire the api-extractor model (`website/lib/models/`) and website docs.
6. **Distill** lessons learned into plugin skills — this is the point of the flywheel: best practices emerge from migration and get recorded in the "effective" plugin (see [plugin.md](plugin.md)).
7. **Advance** — update the status column in [package-inventory.md](package-inventory.md) and choose the next package.

## Ordering

The v3 migration sequence is complete — the record is [package-inventory.md](package-inventory.md#migration-order). The playbook itself remains live: every new package (see [roadmap.md](roadmap.md)) gets the same spec → plan → implement cycle, design doc first. [package-setup.md](package-setup.md) is the durable scaffold reference.
