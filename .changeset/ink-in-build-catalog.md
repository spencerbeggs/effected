---
"@effected/pnpm-plugin-effected": patch
---

## Features

- The `effected:build` catalog now carries `ink`, beside React, with its `:peers` twin. It is the renderer the CLI layer's UI runs on, so a repository building on `@effected/cli-kit` takes it from `catalog:effected:build` (dependencies) and `catalog:effected:build:peers` (peers) instead of silk's catalog. `ink` is also exempt from the release-age quarantine, like every other build-catalog member.
