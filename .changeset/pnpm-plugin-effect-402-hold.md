---
"@effected/pnpm-plugin-effect": patch
---

## Bug Fixes

### Hold every Effect package at exactly 4.0.2

0.13.15 catalogued the `@effect/*` packages at `^4.0.3` while `effect` stayed at `^4.0.2`. `effect@4.0.3` never reached npm (Effect-TS/effect#8994), so a project that adopted 0.13.15 resolved 4.0.3 packages next to `effect@4.0.2`, and the program crashed when it imported them.

* Every entry in the `effect` catalog is now an exact version (`4.0.2`, and `0.51.1` for `@effect/tsgo`) with `strategy: "lock"`, so `catalog:effect` and `catalog:effect:peers` both resolve exactly that version.
* New `overrides` pin `effect` and all 26 `@effect/*` packages to `4.0.2` for any `^4.0.0` request anywhere in the dependency graph. They also cover packages pulled in by other packages, which a catalog cannot reach. They are scoped to the 4.x line, so a tool still built on an Effect release candidate keeps its own version.

The overrides will be removed once `effect@4.0.3` is on npm.
