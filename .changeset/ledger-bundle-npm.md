---
"@effected/ai-plugins": patch
---

## Documentation

* The upgrade ledger records the `bundle.json` and `[package.bundle]` rename, the `@effected/npm` packument reads that answer `Option`, and the `PackedInstall` `NODE_OPTIONS` fix, with adopt entries for `@effected/manifest`, `[package.build.manifest] set`, the `effected-built` condition, the runtime-subdirectory override, `PendingChangesets.readSettled`, `@effected/plugin/env` and the action tsconfig preset
* Ledger entry 0001 replaces its stale `dist/dev` and transform guidance, repoints the env reference and the action tsconfig, and warns about a leftover `tsdown` override and the dropped pre-test build
* The npm adopt entry names the transport gap and its recipe
* Two new traps: a leftover `tsdown` override, and `TS2883` after a dependency stops importing a package in its declarations
* The `effected-packages` skill adds `@effected/manifest`, and its npm, bundler, cli and plugin references and the release skill state the new shapes
