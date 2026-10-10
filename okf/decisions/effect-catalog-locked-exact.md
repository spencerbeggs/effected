---
type: Decision
title: The effect catalog locks every entry to an exact version, held by overrides
description: "Every effect catalog entry (effect, its satellites and @effect/tsgo) carries an exact range with an identical peer under strategy lock, and the plugin publishes version-scoped overrides holding effect and every satellite at 4.0.2 until effect@4.0.3 reaches npm."
status: stable
supersedes: effect-catalog-tracks-stable-minor.md
tags:
  - deps
  - compat
  - release
sources:
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-10-10T00:00:00Z
    title: "Installing the caret range pulls in a broken graph"
  - id: upstream-8994
    resource: https://github.com/Effect-TS/effect/issues/8994
    title: "Every @effect/* 4.0.3 satellite published to npm; core effect@4.0.3 did not"
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effect/savvy.build.ts
    title: "The effect catalog block and the HOLD overrides"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effect/__test__/catalog.test.ts
    title: "The effect catalog describe and the HOLD map in the overrides describe"
  - id: override-probe
    resource: "Probe on pnpm 12.6.0, 2026-10-10: a ^4.0.3 request and a transitive ^4.0.1 request both resolved to 4.0.2 under the overrides; a 4.0.0-rc.118 request was untouched"
generated:
  by: "okfit/claude-code"
  at: 2026-10-10T23:08:17Z
  body_sha256: 892339734e50129667132dd10d34c345f6dbd6c10d40632f90818736f5020891
verified:
  - by: human:spencer
    at: 2026-10-10T23:15:36Z
---

# The effect catalog locks every entry to an exact version, held by overrides

## Context

[The stable-line decision](effect-catalog-tracks-stable-minor.md) gave `effect` and every `@effect/*` satellite the caret `^4.0.0` under `lock-minor`, trusting Effect's promise that the whole family releases together. On 2026-10-10 that promise broke: every 4.0.3 satellite published to npm and core `effect@4.0.3` did not.[^upstream-8994] A satellite at 4.0.3 resolved beside core 4.0.2 dies at import, and a caret admits exactly that pairing. In the owner's words, installing the caret range pulls in a broken graph.[^owner-ruling] The full narrative is [the incident](../incidents/effect-satellites-published-without-core.md).

A catalog range alone could not have prevented it. A caret admits the broken satellite. A catalog also never reaches a dependency's own dependencies, and published `@effected/store` and `@effected/schemastore-cli` depend on satellites directly.

## Decision

Every entry in the `effect` catalog of [`pnpm-plugin-effect`](../modules/pnpm-plugin-effect.md) is an exact range with an identical `peer` under `strategy: "lock"`: `effect` and the 26 satellites at `4.0.2`, `@effect/tsgo` at `0.51.1`.[^savvy-build] `lock` emits the peer verbatim, keeping its operator, where `lock-minor` floored the peer patch to `^4.0.0`. So `catalog:effect` and `catalog:effect:peers` both emit the exact version.

The plugin also publishes one `overrides` entry per package, `"<name>@^4.0.0": "4.0.2"`, for `effect` and all 26 satellites. The selectors are scoped to the stable line. A `^4.0.3` request and a transitive `^4.0.1` request both resolve to 4.0.2. A `4.0.0-rc.118` request sits outside `^4.0.0` and is untouched, so the existing release-candidate `platform-node-shared` overrides keep working.[^override-probe] The registry `upgrade` CLI rewrites catalogs only, never overrides, so the hold survives the bot's next bump.

`__test__/catalog.test.ts` pins both halves.[^catalog-test] It asserts that every entry is exact with an identical peer on `lock`, and that every 4.x entry holds the same version as `effect`. It also checks that the built pnpmfile carries the HOLD overrides. The upgrade bot preserves the exact operator but would still move the satellites to 4.0.3, and the same-version assertion fails on that. That failure is the tripwire.

## Alternatives rejected

- **Keep the caret and rely on the lockfile.** The lockfile protects only this workspace. A consumer's fresh resolve, and any transitive satellite request, takes the broken 4.0.3.
- **Exact catalog pins without overrides.** These do not reach the satellites that published kit packages depend on directly, and they do not survive the upgrade bot, which moves the satellites as soon as they publish.
- **Unscoped overrides (`"effect": "4.0.2"`).** These would also rewrite the release-candidate tools' own `effect` and break the rc.117 and rc.118 bridges.

## Consequences

- **Every catalog entry gets an allowed-versions rule.** `allowedVersionsFromCatalogs` derives a rule only for an exact entry, so it now emits one per satellite, not only for `@effect/tsgo`.
- **Published manifests change only on release.** The whole kit is patch-released so its published manifests carry the exact pins. Before that release, a human runs `pnpm pnpm:export` to rewrite the root `pnpm-workspace.yaml`. Agents do not run it.
- **Every Effect patch is a kit-wide advance again.** The stable-line decision gave up exactly this cost.
- **Removal condition.** Once `effect@4.0.3` resolves on npm, remove the HOLD override block and its test map, then advance per the checklist in effected issue 996 ([advance the effect pin](../runbooks/advance-the-effect-pin.md)).
- **Open: whether the catalog returns to carets.** After the hold lifts, the catalog may stay exact under `lock` or return to `lock-minor` carets. The owner has not decided this, and this Decision does not settle it.

[^upstream-8994]: <https://github.com/Effect-TS/effect/issues/8994>
[^owner-ruling]: Conversation with the repository owner, 2026-10-10.
[^savvy-build]: `packages/pnpm-plugin-effect/savvy.build.ts`
[^override-probe]: Probe on pnpm 12.6.0, 2026-10-10.
[^catalog-test]: `packages/pnpm-plugin-effect/__test__/catalog.test.ts`
