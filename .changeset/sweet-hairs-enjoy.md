---
"@effected/pnpm-plugin-effect": minor
---

## Breaking Changes

### The legacy `effectPeers` catalog name is removed

The distributed catalog set no longer includes `effectPeers`, the camelCase compatibility duplicate of `effect:peers`. Both names carried the identical package set; only the colon-form survives. A workspace still referencing the old name fails resolution at install time with an unknown-catalog error rather than silently resolving elsewhere.

Migration is a rename per specifier — replace `catalog:effectPeers` with `catalog:effect:peers` wherever it appears (typically `peerDependencies`), then reinstall:

```diff
 "peerDependencies": {
-  "effect": "catalog:effectPeers"
+  "effect": "catalog:effect:peers"
 }
```

Nothing about resolved versions changes — only the name. The surviving `effect:peers` catalog carries the same 28 packages the removed name did, pinned under the `lock` strategy (all at `4.0.0-rc.109` except `@effect/tsgo` at `0.36.5`):

* `effect` itself, `@effect/vitest`, `@effect/tsgo`, `@effect/opentelemetry` and `@effect/openapi-generator`
* the four `@effect/ai-*` providers: `ai-anthropic`, `ai-openai`, `ai-openai-compat`, `ai-openrouter`
* the three `@effect/atom-*` bindings: `atom-react`, `atom-solid`, `atom-vue`
* the four platform packages: `platform-browser`, `platform-bun`, `platform-node`, `platform-node-shared`
* the twelve `@effect/sql-*` drivers: `sql-clickhouse`, `sql-d1`, `sql-libsql`, `sql-mssql`, `sql-mysql2`, `sql-pg`, `sql-pglite`, `sql-sqlite-bun`, `sql-sqlite-do`, `sql-sqlite-node`, `sql-sqlite-react-native`, `sql-sqlite-wasm`

### The Effect v3 interop catalogs are removed

The `effect3` and `effect3:peers` catalogs (and the legacy `effect3Peers` duplicate) are no longer distributed. They tracked the latest Effect **v3** releases for dual-version testing during the v3→v4 transition; no consumer references them anymore, so they leave ahead of the `1.0.0` originally slated to drop them. A workspace still referencing `catalog:effect3` or `catalog:effect3:peers` fails resolution at install time with an unknown-catalog error. There is no replacement — a repo that still needs v3 interop pins should declare them directly.

## Features

The distributed `effect` and `effect:peers` catalogs advance from `4.0.0-beta.107` to `4.0.0-rc.109` (Effect's release line renamed beta → rc at rc.108), and `@effect/tsgo` from `0.36.4` to `0.36.5`, still under the `lock` strategy — exact pins, never a caret.

## Dependencies

| Dependency          | Type          | Action  | From   | To    |
| :------------------ | :------------ | :------ | :----- | :---- |
| rolldown-pnpm-config | devDependency | updated | 0.5.10 | 0.6.0 |

The legacy name was synthesized by the catalog generator, not declared here — `rolldown-pnpm-config` emitted every peers catalog under both spellings through `0.5.x` and emits only the colon form as of `0.6.0`.
