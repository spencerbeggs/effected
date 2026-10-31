---
type: Incident
title: The catalog sync moved the effect catalog onto Effect 4.1 under a kit built on 4.0
description: "The unattended catalog-sync job took the in-range 4.1.0 for the caret effect catalog, so pnpm-plugin-effect 0.19.1 to 0.19.3 pinned every consumer graph to Effect 4.1 while the whole published kit was built on 4.0.7 and imported the Crypto module 4.1.0 removed; the kit died at import, and the Effect family is now held to one minor with tildes."
status: draft
occurred: "2026-10-29"
guard: ../../packages/pnpm-plugin-effected/__test__/catalog.test.ts
tags:
  - release
  - deps
  - compat
sources:
  - id: bot-commit-410
    resource: https://github.com/spencerbeggs/effected/commit/216a94cb
    title: "chore(pnpm-plugin-effect): update 28 catalog versions (2026-10-29; effect ^4.0.7 to ^4.1.0)"
  - id: bot-commit-411
    resource: https://github.com/spencerbeggs/effected/commit/1902d734
    title: "chore(pnpm-plugin-effect): update 28 catalog versions (2026-10-31; to ^4.1.1)"
  - id: releases
    resource: ../../packages/pnpm-plugin-effected/CHANGELOG.md
    title: "The 0.19.1, 0.19.2 and 0.19.3 entries (releases #1159, #1163, #1166)"
  - id: sync-script
    resource: ../../lib/scripts/catalog-sync.ts
    title: "The sync runs rolldown-pnpm-config upgrade savvy.build.ts --yes"
  - id: import-probe
    resource: "Probe 2026-10-31: @effected/jsonc@0.21.0 beside effect@4.1.1 fails at import with: The requested module 'effect' does not provide an export named 'Crypto'"
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effected/savvy.build.ts
    title: "The tilde effect catalog"
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T18:50:20Z
integrity:
  generated:
    body: ca7f281cfbc5c019
---

# The catalog sync moved the effect catalog onto Effect 4.1 under a kit built on 4.0

## What shipped broken

The [catalog-sync job](../interfaces/catalog-sync-cli.md) runs `rolldown-pnpm-config upgrade savvy.build.ts --yes` unattended on every pull request to `main`.[^sync-script] On 2026-10-29 it moved every `effect` catalog entry of `@effected/pnpm-plugin-effect` from `^4.0.7` to `^4.1.0`, and on 2026-10-31 to `^4.1.1`.[^bot-commit-410][^bot-commit-411] Under a caret, `--yes` takes the newest in-range candidate, and 4.1.0 was in range. Releases 0.19.1, 0.19.2 and 0.19.3 of the plugin shipped that catalog.[^releases]

Every published `@effected/*` package at the time was built on Effect 4.0.7 and advertised the caret peer `^4.0.0`, which admits 4.1. The plugin's derived overrides (`"effect@^4.0.0": "4.1.1"`) pinned every `effect` in a consumer's graph to the catalog version, so a consumer that installed those plugin releases ran the 4.0.7-built kit on 4.1.

## What it looked like

The kit died at import. Effect 4.1.0 removed the root `Crypto` module, which published kit packages import from `effect`. `@effected/jsonc@0.21.0` beside `effect@4.1.1` fails with `The requested module 'effect' does not provide an export named 'Crypto'`.[^import-probe] The install itself succeeded and every peer was satisfied, so nothing warned before the first import. The same failure reached this repository's own toolchain (`@savvy-web/*`, okfit, tsdoctor, vitest-agent), which loads the published kit.

## Root cause

The caret catalog relied on the advance itself to stop an Effect minor reaching consumers before the kit was ported to it: [the stable-line decision](../decisions/effect-catalog-tracks-stable-minor.md) named that risk and accepted it. Nothing enforced it once an unattended job could move the catalog. The bot did its job: the candidate was in range. The graph-wide pins then made the consequence total. A consumer could not keep the kit on the core it was built for, because the override rewrote it.

## The guard

[The effect catalog holds the family to one minor](../decisions/effect-catalog-minor-lock.md):[^savvy-build]

- Every `effect` and `@effect/*` entry is `range: "~4.1.1"`, `peer: "~4.1.0"`, `strategy: "lock-minor"`. The sync's `--yes` can take a new patch but can no longer cross a minor; an Effect minor arrives only through [advance the effect pin](../runbooks/advance-the-effect-pin.md), which ports and releases the kit with it.
- `__test__/catalog.test.ts` requires the tilde on every 4.x entry and a peer floored to the minor, so a caret coming back fails the suite.
- The kit's published `effect` peer becomes `~4.1.0`, so a kit built on 4.1 no longer claims to accept a future 4.2.

The old plugin's 0.19.1 to 0.19.3 releases are to be deprecated on npm by the owner. The plugin continues as `@effected/pnpm-plugin-effected`. While the toolchain still loads the 4.0.7-built kit, this repository bridges it with a root `.pnpmfile.cjs` `readPackage` hook: see [one resolved effect copy](../conventions/one-resolved-effect-copy.md).

[^sync-script]: `lib/scripts/catalog-sync.ts`
[^bot-commit-410]: Commit 216a94cb, 2026-10-29.
[^bot-commit-411]: Commit 1902d734, 2026-10-31.
[^releases]: `packages/pnpm-plugin-effected/CHANGELOG.md`, entries 0.19.1 to 0.19.3.
[^import-probe]: Import probe, 2026-10-31.
[^savvy-build]: `packages/pnpm-plugin-effected/savvy.build.ts`
