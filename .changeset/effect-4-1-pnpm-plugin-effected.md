---
"@effected/pnpm-plugin-effected": minor
---

## Breaking Changes

### Renamed from @effected/pnpm-plugin-effect

This package replaces `@effected/pnpm-plugin-effect` and continues its version line. The old name is deprecated and gets no further releases. Swap the entry in `configDependencies` (write it by hand with its `+sha512` integrity; `pnpm add --config` strips integrity hashes) and reinstall from scratch.

### One catalog, `effected`

Consumers see a single catalog, `effected`, with `effect` folded in. The `effect`, `effect:peers` and `effected:peers` catalogs are removed, so every `catalog:effect`, `catalog:effect:peers` and `catalog:effected:peers` reference becomes `catalog:effected`. Peers written `catalog:effected` publish the catalog's install range (for example `effect: ~4.1.1`) rather than a floored one.

### Effect held to one minor

The Effect family is held at `~4.1.1` under `lock-minor`, not a caret, and the plugin derives one override per family member so `effect` and every satellite resolve to the catalog version across the whole graph. A caret had let the unattended catalog sync carry consumers onto Effect 4.1 while the published kit was still built on 4.0.x. Rebuilt on Effect 4.1.1: every `@effected/*` peer on `effect` is now `~4.1.0`.

## Bug Fixes

* Releases 0.19.1–0.19.3 of the old name moved the catalog to Effect 4.1 under a kit built on 4.0.7, and crashed consumers at import with `does not provide an export named 'Crypto'`. Do not install them; move to this package. Closes #1146.
