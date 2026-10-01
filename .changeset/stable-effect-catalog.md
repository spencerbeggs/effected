---
"@effected/pnpm-plugin-effect": minor
---

## Breaking Changes

- The `effect` and `effect:peers` catalogs give `effect` and every `@effect/*` package the range `^4.0.0` under the `lock-minor` strategy, in place of an exact release-candidate pin. Your lockfile now holds the exact `effect` version, so a fresh resolve can pick up a newer `4.x`. `@effect/tsgo` is `0.47.2` (peer `0.47.0`).
- `catalog:effected` names every `@effected` package at its new minor. Bump the `configDependencies` pin (version and integrity together), then reinstall without the old lockfile, or the previous catalog versions keep resolving.

## Bug Fixes

- The scoped `@effect/platform-node-shared` override now also covers the `4.0.0-rc.118` parent. Tools still built on that release candidate take `@effect/platform-node-shared` with a caret, which a fresh resolve would pair with the stable `4.0.0` package built for a different `effect`. The override keeps it at `4.0.0-rc.118` under that parent only, so a stable install is never touched.
