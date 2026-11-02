---
id: "0002"
title: The catalog plugin is renamed and serves one effected catalog
kind: tooling
shows: none
applies:
  effect: ">=4.1.0"
detect: ["catalog:(effect|effect:peers|effected:peers)([^a-z:]|$)", "@effected/pnpm-plugin-effect([^e]|$)"]
closes: ["spencerbeggs/effected#1146"]
renames:
  "@effected/pnpm-plugin-effect": "@effected/pnpm-plugin-effected"
---

`@effected/pnpm-plugin-effect` is replaced by `@effected/pnpm-plugin-effected`, which continues its version line. The old name is deprecated and gets no further releases. **Never install the old plugin's 0.19.1 to 0.19.3**: they moved the catalog to Effect 4.1 while the published kit was still built on 4.0.x, and that kit dies at import (`does not provide an export named 'Crypto'`). A repository pinned to one of them is on a broken catalog; move it first.

What to change:

- **The config dependency.** `bump-config-deps.mjs` applies this rename. Confirm `configDependencies` names `@effected/pnpm-plugin-effected` at a plain version, with no `+sha512` suffix.
- **The release-age exclude.** If `minimumReleaseAgeExclude` (or another release-age gate's exclude list) names `@effected/pnpm-plugin-effect`, rename that entry before you install, or the gate refuses the new plugin's fresh release. Keep the other entries. A fresh Effect release can be refused the same way: add `effect` and `@effect/*` to the exclude list, or wait it out.
- **Every catalog reference.** The workspace now sees exactly one catalog, `effected`, holding the Effect family and the kit. `catalog:effect`, `catalog:effect:peers` and `catalog:effected:peers` no longer exist, and an install with any left behind fails with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`. Rewrite each one to `catalog:effected`, in `dependencies`, `devDependencies` and `peerDependencies` alike.
- **An `@effected/*` range pinned outside the catalog** must be bumped by hand: on `0.x` a caret pins the minor. Prefer moving it onto `catalog:effected`.

How it shows itself:

- **The Effect family is held to one minor.** `catalog:effected` gives `effect` and every `@effect/*` member a tilde range on the current minor, not a caret, so the next Effect minor arrives only with a new plugin release. `@effect/tsgo` stays on its own `0.x` line. The plugin still derives one override per family member pinning it across the whole graph; never hand-write those pins.
- **Published peer ranges change.** `pnpm pack` resolves `catalog:effected` to the catalog's install range, so a library you publish advertises `effect: ~4.1.x` where it advertised a floored `^4.0.0`, and an `@effected/*` peer advertises the patch rather than the floored minor. If you need a floored peer, write that range by hand in that one manifest.

This round closes effected #1146 (replace `pnpm-plugin-effect` with `pnpm-plugin-effected`). If you track a workaround waiting on the rename, adopt the shipped shape and close your ticket with a link to it. Applying the `@effect/tsgo` patch on install was split out into effected #1167, which stays open.
