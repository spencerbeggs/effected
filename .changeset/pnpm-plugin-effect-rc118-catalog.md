---
"@effected/pnpm-plugin-effect": minor
---

## Features

The `effect` and `effect:peers` catalogs pin `effect` and every `@effect/*` package to exactly `4.0.0-rc.118`, and `catalog:effected` names every `@effected` package at its new minor (for example `@effected/workspaces ^0.30.0`). Bump the `configDependencies` pin (version and integrity together), then reinstall without the old lockfile, or the previous catalog versions keep resolving.
