---
"@effected/workspaces": patch
---

## Bug Fixes

* The packed-install gate message now says to run `pnpm build --filter <package>` before the packed-install tests, instead of pointing at the retired `build:prod` script
