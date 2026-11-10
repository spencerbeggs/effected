---
"@effected/pnpm-plugin-effected": patch
---

## Bug Fixes

* `@rspack/*` is excluded from `minimumReleaseAge`. The rspack packages publish in lockstep with `@rsbuild/core`, so a fresh rsbuild release no longer fails to resolve while its rspack dependencies are still quarantined.
