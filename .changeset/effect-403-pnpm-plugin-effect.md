---
"@effected/pnpm-plugin-effect": minor
---

## Features

### Catalog-derived Effect overrides

The hand-written 27-entry hold override block is replaced by `overridesFromCatalogs: { catalog: "effect" }`. At build time it derives one line-scoped `"<name>@^4.0.0": "<catalog version>"` override per family member, and `"@effect/tsgo@^0.51.0": "0.51.1"` for tsgo on its own 0.x line, so the pins move with the catalog. The whole 4.x graph, devDependencies and their closures included, resolves to the catalog's `effect`, and a missing core now fails the install loudly.

The `effect` catalog returns to carets under `lock-minor` (`@effect/tsgo` stays exact), now at `^4.0.3`. The two platform-node-shared bridge entries stay.

## Dependencies

| Dependency          | Type       | Action  | From  | To    |
| :------------------ | :--------- | :------ | :---- | :---- |
| rolldown-pnpm-config | devDependency | updated | ^2.0.3 | ^2.1.0 |
