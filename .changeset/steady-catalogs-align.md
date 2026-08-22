---
"@effected/pnpm-plugin-effect": minor
---

## Features

### `catalog:effected` and `catalog:effected:peers`

The plugin now ships two additional pnpm catalogs alongside the existing `effect` pair, covering every published `@effected/*` kit package (`@effected/pnpm-plugin-effect` itself excluded). Reference a kit package by catalog name instead of a hand-written range:

```json
{
  "dependencies": {
    "@effected/workspaces": "catalog:effected"
  },
  "peerDependencies": {
    "@effected/workspaces": "catalog:effected:peers"
  }
}
```

On `0.x`, a caret does not cross a minor, so a hand-written range like `^0.14.0` silently stops resolving once that package cuts `0.15.0`. `catalog:effected` replaces the range with a name and moves the whole kit surface in one step when the config dependency is upgraded. `catalog:effected:peers` carries the same package set at a minor-floored peer range, computed the same way the existing `effect:peers` catalog is.

The `effected` catalogs are rebuilt automatically as kit packages release, so each new version of this package carries the kit's current versions — upgrading the config dependency is how a consumer picks them up:

```bash
pnpm update --config @effected/pnpm-plugin-effect
pnpm install
```
