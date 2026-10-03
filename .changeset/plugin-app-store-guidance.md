---
"@effected/ai-plugin": minor
---

## Documentation

* The `effected-packages` references for `app`, `store` and `config-file` cover `App.layerDirs`, the keyed `layerAs` and `layerSqliteAs` layers, `location`, Migrator ledger adoption and mirroring, and the wider-key caveat on `ConfigFile.layer`.
* The `effect-v4-services-layers` skill states the verified memoisation rule (a layer builds once per provided graph and a nested `Effect.provide` reuses the enclosing build, while sequential or sibling provides build again) and the key-pin edge case where a key parameter accepts wider service shapes.
* The `effect-reviewer` and `effect-developer` agents check a project's database wiring: one shared layer binding per database, `App.layerDirs` at a CLI edge, a distinct `layerAs` filename, per-connection pragmas in `client` / `onConnect` rather than migrations, and retrying only a warm-up open on `SQLITE_BUSY`.
* The `effect-v4-testing` memfs reference reflects the `FileSystem` requirement on the app database layers.
