---
status: current
module: effected
category: meta
created: 2026-07-06
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 85
related:
  - architecture.md
  - effect-standards.md
  - package-inventory.md
  - package-setup.md
  - plugin.md
---

# Migration playbook

## Overview

The per-package cycle for adding an `@effected/*` library. The porting program that named the doc is finished — every remaining addition is a new package — but the cycle is unchanged, and it is still what a new package follows. The design doc is written first; the build follows.

## Steps per package

1. **Analyze** the target surface — API, dependencies, IO boundaries — from the consumer survey that scoped the package.
2. **Design** — write the package's design doc under `packages/`, stating its target class-based API and tier per [effect-standards.md](effect-standards.md), with the module-per-concept layout.
3. **Build** against Effect v4.
4. **Test** with `@effect/vitest` following the `__test__/` conventions in the root `CLAUDE.md` Testing section and the sibling suites.
5. **Document** — wire the api-extractor model (`website/lib/models/`) and website docs.
6. **Distill** lessons into plugin skills. This is the point of the cycle: best practices that emerge from a build get recorded in the "effected" plugin (see [plugin.md](plugin.md)).
7. **Advance** — add the package's row to [package-inventory.md](package-inventory.md).

## Scaffolding

Step 2's mechanical half — creating the workspace package skeleton — is [package-setup.md](package-setup.md), the durable scaffold reference. [package-inventory.md](package-inventory.md) is the record of which packages exist and where each came from.
