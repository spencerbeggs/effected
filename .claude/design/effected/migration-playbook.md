---
status: current
module: effected
category: meta
created: 2026-07-06
updated: 2026-07-15
last-synced: 2026-07-15
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

The per-package cycle for adding an `@effected/*` library — whether porting a v3 `*-effect` repo or building a new invention. Every package is a redesign against Effect v4, not a lift-and-shift (see [architecture.md](architecture.md)). The design doc is written first; the port or build follows.

## Steps per package

1. **Analyze** the target surface — API, dependencies, IO boundaries. For a port, start from the source repo; for a new package, from the consumer survey that scoped it.
2. **Design** — write the package's design doc under `packages/`, stating its target class-based API and tier per [effect-standards.md](effect-standards.md), with the module-per-concept layout.
3. **Port or build** to Effect v4.
4. **Test** with `@effect/vitest` following the `__test__/` conventions in the root `CLAUDE.md` Testing section and the sibling suites.
5. **Document** — wire the api-extractor model (`website/lib/models/`) and website docs.
6. **Distill** lessons into plugin skills. This is the point of the cycle: best practices that emerge from a port get recorded in the "effective" plugin (see [plugin.md](plugin.md)).
7. **Advance** — update the package's row in [package-inventory.md](package-inventory.md) and choose the next package.

## Scaffolding

Step 2's mechanical half — creating the workspace package skeleton — is [package-setup.md](package-setup.md), the durable scaffold reference. [package-inventory.md](package-inventory.md) is the record of which packages exist and where each came from.
