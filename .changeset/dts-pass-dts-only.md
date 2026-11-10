---
"@effected/bundler": patch
---

## Bug Fixes

* The declaration pass now picks its declarations-only option from the rolldown-plugin-dts copy tsdown will load: `dtsOnly` on 0.30 and later, `emitDtsOnly` below that. Builds on 0.30 no longer record the warning "The `emitDtsOnly` option is deprecated. Use `dtsOnly` instead." in `dist/prod/issues.json`, and builds still on 0.29, such as a workspace carrying silk's `tsdown>rolldown-plugin-dts` override, keep their declarations-only pass. No consumer action is needed.
* `DtsPassDtsOptions` now carries `dtsOnly` or `emitDtsOnly` as optional fields, exactly one of them set, instead of a fixed `emitDtsOnly`. `dtsPassDtsOptions()` takes an optional second argument naming the rolldown-plugin-dts version to target.
