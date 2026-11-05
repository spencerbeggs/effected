---
"@effected/store": patch
---

## Documentation

* The `onConnect` option (#1182) on `Store.layerSqlite` and `Cache.layerSqlite` now shows how to run several pragmas by sequencing the statements, where the first failure fails the layer.
