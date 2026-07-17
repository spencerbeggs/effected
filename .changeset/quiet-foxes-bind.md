---
"@effected/pnpm-plugin-effect": patch
---

## Bug Fixes

- Added a direct `effect` devDependency (pinned to the workspace's `catalog:effect`) so pnpm binds `@savvy-web/bundler` 2.0's published `@effected/*` peers to Effect v4 instead of the v3 version `rolldown-pnpm-config` carries. Without this, the package failed to build.
