---
type: Incident
title: The plugin's catalog paired 4.0.3 satellites with core effect 4.0.2
description: "pnpm-plugin-effect 0.13.15 shipped an effect catalog with the @effect/* satellites at ^4.0.3 and effect at ^4.0.2, after upstream published every 4.0.3 satellite but not core; a fresh resolve died at import, and the catalog now locks exact versions behind version-scoped overrides."
status: draft
occurred: "2026-10-10"
guard: ../../packages/pnpm-plugin-effect/__test__/catalog.test.ts
tags:
  - release
  - deps
  - compat
sources:
  - id: upstream-8994
    resource: https://github.com/Effect-TS/effect/issues/8994
    title: "Every @effect/* 4.0.3 satellite published around 10:04 UTC 2026-10-10; core effect@4.0.3 did not"
  - id: upstream-8186
    resource: https://github.com/Effect-TS/effect/issues/8186
    title: "The earlier partial publish this one repeats"
  - id: registry-check
    resource: "npm:effect"
    title: "effect@4.0.3 still 404 at 22:55 UTC 2026-10-10; latest 4.0.2"
  - id: release-994
    resource: https://github.com/spencerbeggs/effected/pull/994
    title: "release: pnpm-plugin-effect@0.13.15, runtimes@0.10.2"
  - id: bot-commit
    resource: https://github.com/spencerbeggs/effected/commit/c2919488
    title: "chore(pnpm-plugin-effect): update 27 catalog versions"
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effect/savvy.build.ts
    title: "The exact effect catalog and the HOLD overrides"
generated:
  by: "okfit/claude-code"
  at: 2026-10-10T23:08:17Z
  body_sha256: d87b25169bdfbbaf9189901eee0253614891d914d2bc1996592ec7edefa8ddc8
---

# The plugin's catalog paired 4.0.3 satellites with core effect 4.0.2

## What shipped broken

Upstream published every `@effect/*` 4.0.3 satellite to npm at about 10:04 UTC on 2026-10-10. Core `effect@4.0.3` never published. It still returned 404 at 22:55 UTC, and npm's `latest` stayed 4.0.2.[^upstream-8994][^registry-check] The 4.0.3 satellites peer on `effect` `^4.0.3`. This repeats an earlier upstream partial publish.[^upstream-8186] The maintainers closed the issue and plan to move to npm staged publishing.

The registry bot's `upgrade` run (commit c2919488) saw the satellites publish and bumped all of them in the [`pnpm-plugin-effect`](../modules/pnpm-plugin-effect.md) catalog.[^bot-commit] Release #994 then published `@effected/pnpm-plugin-effect@0.13.15` with the 26 satellites at `^4.0.3` and `effect` at `^4.0.2`.[^release-994] Every consumer that adopted 0.13.15 received the broken pair.

Two published kit packages pull satellites transitively, so no catalog can govern them. `@effected/store@0.13.1` depends on `@effect/sql-sqlite-node` `^4.0.1`, and `@effected/schemastore-cli@0.21.4` depends on `@effect/platform-node` `^4.0.2`. A fresh resolve of either takes satellite 4.0.3.

## What it looked like

A fresh resolve paired a 4.0.3 satellite with core 4.0.2, and the program died at import because `effect/dist/net/AddressResolver.js` was missing. A vitest project that hit this still reported "N passed, 0 failed", so a test run did not show the failure.

## Root cause

The upstream partial publish broke the guarantee that Effect releases its whole family together. The [stable-line catalog decision](../decisions/effect-catalog-tracks-stable-minor.md) relied on that guarantee. Under it, a caret admitted the unpaired satellite, and the upgrade bot, doing its job, moved the catalog onto the satellites as soon as they existed.

## The guard

[The effect catalog locks every entry to an exact version](../decisions/effect-catalog-locked-exact.md) has three parts.[^savvy-build]

- Every `effect` catalog entry is exact with an identical peer under `strategy: "lock"`.
- The plugin publishes the overrides `"<name>@^4.0.0": "4.0.2"` for `effect` and every satellite. They reach transitive requests and survive the upgrade bot, which rewrites catalogs only.
- `__test__/catalog.test.ts` asserts that every 4.x entry holds `effect`'s own version. The next bot bump to 4.0.3 satellites fails that check before it can ship.

The whole kit is patch-released on this fix so published manifests carry the exact pins. Before that release, a human runs `pnpm pnpm:export`. Once `effect@4.0.3` resolves on npm, the hold comes out per [advance the effect pin](../runbooks/advance-the-effect-pin.md).

[^upstream-8994]: <https://github.com/Effect-TS/effect/issues/8994>
[^registry-check]: The npm registry for `effect`, checked 2026-10-10 at 22:55 UTC.
[^upstream-8186]: <https://github.com/Effect-TS/effect/issues/8186>
[^bot-commit]: Commit c2919488, `chore(pnpm-plugin-effect): update 27 catalog versions`.
[^release-994]: <https://github.com/spencerbeggs/effected/pull/994>
[^savvy-build]: `packages/pnpm-plugin-effect/savvy.build.ts`
