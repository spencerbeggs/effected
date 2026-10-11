---
type: Decision
title: The effect family is pinned graph-wide by overrides derived from the catalog
description: "The plugin's effect catalog rides the stable line with carets under lock-minor, and a permanent overridesFromCatalogs directive derives one line-scoped override per family member, pinning effect and every satellite to the catalog's exact version across the whole consumer graph."
status: draft
supersedes: effect-catalog-locked-exact.md
tags:
  - deps
  - compat
  - release
sources:
  - id: owner-ruling
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-10-11T00:00:00Z
    title: "Keep the explicit overriding, derived from the catalog; the graph-wide reach is the accepted trade-off"
  - id: override-probe
    resource: "Probe on pnpm 12.6.0, 2026-10-11: with @effect/ai-openrouter@4.0.3 beside effect@4.0.2 in a consumer, a parent-scoped override rewrote the satellite's declared peer range but the peer still resolved to 4.0.2; the line-scoped effect@^4.0.0 override moved the graph to 4.0.3"
  - id: directive
    resource: https://github.com/spencerbeggs/rolldown-pnpm-config/pull/237
    title: "rolldown-pnpm-config 2.1.0: overridesFromCatalogs"
  - id: savvy-build
    resource: ../../packages/pnpm-plugin-effect/savvy.build.ts
    title: "The effect catalog block and the overridesFromCatalogs directive"
  - id: catalog-test
    resource: ../../packages/pnpm-plugin-effect/__test__/catalog.test.ts
    title: "The effect catalog describe and the derived family pins in the overrides describe"
generated:
  by: okfit/claude-code
  at: 2026-10-11T17:06:53Z
  body_sha256: a495154c83d83eb7895929a3bb6d8478d267ec5eb8d09a93aea5acbf9a601f70
---

# The effect family is pinned graph-wide by overrides derived from the catalog

## Context

[The exact-lock decision](effect-catalog-locked-exact.md) answered the 2026-10-10 incident, in which every 4.0.3 satellite published a day before core `effect@4.0.3` ([the incident](../incidents/effect-satellites-published-without-core.md)), by pinning the catalog exact and publishing a hand-written HOLD block of 27 `"<name>@^4.0.0": "4.0.2"` overrides. It left open whether the catalog would return to carets, and it noted the hold had to be removed or moved by hand because the registry `upgrade` CLI rewrites catalogs only.

Once core published, the owner asked whether the explicit overriding should stay permanently, since satellite-before-core publishes have bitten more than once.[^owner-ruling] Two facts settled the shape. First, the override must be family-wide and line-scoped: a parent-scoped `"<satellite>@<v>>effect": "<v>"` entry rewrites the satellite's declared peer range, but a peer is satisfied by whatever `effect` the consumer already has in scope, so the broken pairing survives; only `"effect@^4.0.0": "<v>"` moves the graph.[^override-probe] Second, the block cannot be computed inside `savvy.build.ts`: `rolldown-pnpm-config export` and `preview` statically evaluate the `PnpmConfigPlugin(...)` argument and refuse non-literal values, so a hand-written block drifts the first time the upgrade bot moves the catalog and nobody touches it.

## Decision

`rolldown-pnpm-config` 2.1.0 adds `overridesFromCatalogs`, a build-time directive resolved in `freeze` so the pnpmfile, `export` and `preview` all carry it.[^directive] The plugin declares `overridesFromCatalogs: { catalog: "effect" }` and keeps only the two release-candidate `platform-node-shared` bridge entries in its authored `overrides`.[^savvy-build] For every family member the directive emits `"<name>@^4.0.0": "<catalog version>"`, so the pins move with the catalog literal and the upgrade bot cannot leave them behind.

The catalog itself returns to carets under `lock-minor`, which the stable-line decision had chosen before the incident: the override layer, not the catalog range, is now what stops a satellite from pairing with an older core. `@effect/tsgo` versions on its own 0.x line and stays exact in the catalog; the directive pins it on that line (`"@effect/tsgo@^0.51.0": "0.51.1"` today), so one tsgo serves the graph as well.

`__test__/catalog.test.ts` pins both halves: every entry is a caret on `lock-minor` with a peer floored to its minor, every 4.x entry names `effect`'s own version, and the built pnpmfile's `overrides` equal the pins derived from the catalog literal plus the two bridge entries.[^catalog-test]

## Alternatives rejected

- **Parent-scoped `satellite>effect` overrides.** Proposed as the form that would force each satellite onto its own `effect`. The probe showed it does not reach the peer resolution; the pairing survives.[^override-probe]
- **A hand-written family block moved on every advance.** The exact-lock shape. It works, but the upgrade bot cannot move it and a stale block holds every consumer on the old patch until a human notices.
- **No override layer, carets only.** The pre-incident shape. A caret admits the next satellite before core publishes, and a catalog never reaches a dependency's own dependencies.
- **A floor-only selector that lifts stragglers but never holds a newer request down.** It would not have stopped the incident: the satellites' `^4.0.0` requests are not a sub-range of a `<=4.0.2` selector, so nothing would have held them.

## Consequences

- **Every Effect patch is still a kit-wide move, for every consumer repository.** The pin applies to the whole graph, devDependencies and their closures included, so a tool built on 4.0.2 runs on 4.0.3 once the catalog advances, and a tool built ahead of the catalog is held back until it moves. The owner accepted this as the price of the guard; Effect's patch releases are expected to settle.[^owner-ruling] It is one more reason the advance runbook demands a full build and test pass before release.
- **A missing core now fails at install time.** When satellites publish before core, the pin asks for an `effect` version npm does not have and the resolve fails loudly, instead of a satellite pairing silently with the old core and dying at import.
- **The bridge entries stay authored.** The release-candidate `platform-node-shared` entries are parent-scoped by design and sit outside the family pin; they are removed as their tool consumers rebuild.
- **A consumer's own `overrides` still win** on the same selector, so a repository that genuinely needs a tool on its own `effect` can say so locally.

[^owner-ruling]: Conversation with the repository owner, 2026-10-11.
[^override-probe]: Probe on pnpm 12.6.0, 2026-10-11.
[^directive]: <https://github.com/spencerbeggs/rolldown-pnpm-config/pull/237>
[^savvy-build]: `packages/pnpm-plugin-effect/savvy.build.ts`
[^catalog-test]: `packages/pnpm-plugin-effect/__test__/catalog.test.ts`
