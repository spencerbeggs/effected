---
type: Decision
title: The effect catalog holds the Effect family to one minor with tilde ranges
description: "Every effect and @effect/* catalog entry is a tilde range on the current Effect minor with a peer floored to that minor (~4.<minor>.0) under lock-minor, so no unattended upgrade can cross an Effect minor and the kit's published peer admits only the minor it was built on; @effect/tsgo keeps a 0.x caret, and the derived graph-wide pins are unchanged."
status: draft
supersedes: effect-catalog-tracks-stable-minor.md
tags:
  - deps
  - compat
  - release
sources:
  - id: incident
    resource: ../incidents/catalog-crossed-effect-minor.md
    title: "The catalog sync moved the effect catalog onto Effect 4.1 under a kit built on 4.0"
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effected/savvy.build.ts
    title: "The effect catalog block"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effected/__test__/catalog.test.ts
    title: "holds every 4.x entry to one minor under lock-minor with a floored peer"
  - id: sync-script
    resource: ../../lib/scripts/catalog-sync.ts
    title: "The unattended upgrade --yes the sync runs"
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T18:50:20Z
integrity:
  generated:
    body: 44622a2519a92021
---

# The effect catalog holds the Effect family to one minor with tilde ranges

## Context

[The stable-line decision](effect-catalog-tracks-stable-minor.md) chose a caret (`^4.0.0`) for the Effect family and rejected the tilde. It accepted that a consumer could resolve an Effect minor the kit had not been tested on, and named the kit's own advance as the guard. [The derived-overrides decision](effect-overrides-derived-from-catalog.md) kept the caret and added graph-wide pins derived from the catalog.

Under a caret, that guard did not hold. The catalog-sync job runs the `upgrade` CLI with `--yes` on every pull request, and `--yes` takes the newest candidate in range.[^sync-script] Effect 4.1.0 was in range, so the job moved the catalog to `^4.1.0` and the plugin released it. The derived pins then put 4.1 under a published kit built on 4.0.7, which imported a module 4.1.0 removed, and the kit died at import.[^incident]

## Decision

Every `effect` and `@effect/*` entry in the plugin's `effect` catalog is `range: "~4.<minor>.<patch>"`, `peer: "~4.<minor>.0"`, `strategy: "lock-minor"`.[^savvy-build] `rolldown-pnpm-config` keeps the operator when it derives the peer, so the floor is a tilde on the minor, not a caret. `@effect/tsgo` keeps a caret on its own `0.<minor>` line, because on a 0.x line a caret already holds the minor.

`overridesFromCatalogs` is unchanged. It still derives the line-scoped `"<name>@^4.0.0": "<catalog version>"` pins, and they still hold the whole graph on the one version the catalog names.

`__test__/catalog.test.ts` requires the tilde on every 4.x entry, a peer floored to its minor, `lock-minor`, and one version across the family.[^catalog-test]

## Alternatives rejected

- **Keep the caret and trust the advance.** It failed in production: the unattended sync is not the advance, and nothing stopped it taking the next minor.
- **Exact pins under `lock`.** That would make every Effect patch a kit-wide advance again and keep consumers off compatible patches. The tilde blocks only the minor, which is where the kit's `@stability unstable` imports can break.
- **Stop the sync touching the `effect` catalog.** The sync exists to keep the catalog current without a human. A tilde keeps that for patches and leaves the minor decision to the runbook.

## Consequences

- **An Effect minor is a deliberate advance.** A human edits the ranges through [advance the effect pin](../runbooks/advance-the-effect-pin.md), the kit is ported and released on the new minor, and the plugin carries it. The bot cannot do this step.
- **Effect patches still flow.** The sync can move the family to a new patch within the minor on its own. Because the derived pins follow, each such move is still a graph-wide patch move for consumers, as before.
- **The kit's published peer admits one minor.** A kit built on one minor advertises `effect` `~4.<minor>.0`, so a consumer on the next minor gets a peer warning rather than a silent import crash. Every kit release built on an earlier minor stays stranded until it is republished, which the advance does anyway.

[^incident]: [The catalog crossed an Effect minor](../incidents/catalog-crossed-effect-minor.md).
[^sync-script]: `lib/scripts/catalog-sync.ts`
[^savvy-build]: `packages/pnpm-plugin-effected/savvy.build.ts`
[^catalog-test]: `packages/pnpm-plugin-effected/__test__/catalog.test.ts`
