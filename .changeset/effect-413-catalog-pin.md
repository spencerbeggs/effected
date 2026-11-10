---
"@effected/pnpm-plugin-effected": patch
---

## Bug Fixes

- The `effected` catalog now serves each Effect-family member the plugin pins graph-wide at its exact override version, for example `effect: 4.1.3`, instead of the `~` range it is authored with. pnpm never applies a version-selector override such as `effect@^4.0.0` to a `catalog:` specifier (pnpm/pnpm#17922), so a consumer whose manifests write `catalog:effected` resolved a second, newer `effect` beside the pinned one as soon as Effect published a patch. The authored `~` literal is unchanged, so the catalog sync and the derived peers behave as before, and the `effected:peers` twin keeps its floored `~4.1.0`.
- A repository whose own `pnpm-workspace.yaml` still carries a `catalogs.effected` block from an earlier export keeps its local ranges, because a local entry wins over the plugin's. Re-export the catalogs, or delete that block, to pick up the exact pins.
- The `effected:peers` and `effected:build:peers` catalogs are now visible to consumers. Spell every peer through them (`catalog:effected:peers`, `catalog:effected:build:peers`) and keep `catalog:effected` for `dependencies` and `devDependencies`: `pnpm pack` writes a `catalog:` peer as the served value, so a peer spelled `catalog:effected` would now publish an exact Effect version. Each peers twin floors its ranges to the minor, for example `~4.1.0`.

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | config | updated | ~4.1.2 | ~4.1.3 |
| rolldown-pnpm-config | devDependency | updated | ^2.4.5 | ^2.4.6 |

- The `effected` catalog moves the Effect family to 4.1.3, and the derived graph-wide pins follow it.
