---
"@effected/pnpm-plugin-effected": patch
---

## Refactoring

* The plugin now declares a single `effected` catalog instead of declaring `effect` and `effected` separately and folding them in its `updateConfig` hook. What a consumer installs is unchanged: one `effected` catalog holding the Effect family and the kit, and the same graph-wide Effect pins.
* The graph-wide pins are selected with `overridesFromCatalogs` `include: ["effect", "@effect/*"]`, so a kit package added to the catalog never gains an override.

## Dependencies

| Dependency           | Type          | Action  | From   | To     |
| :------------------- | :------------ | :------ | :----- | :----- |
| rolldown-pnpm-config | devDependency | updated | ^2.2.1 | ^2.3.0 |
