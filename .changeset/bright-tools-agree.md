---
"@effected/mcp": patch
---

## Bug Fixes

* Fixed the `schema_build` and `schema_check` tools splitting a reused `identifier` into `X`, `X_1` and `X_2` `$defs` when served by the `effected-mcp` bin of `@effected/plugin`. They now lower a config's schemas with the `effect` beside the config, as `effected schema build` does, so the two front ends agree.
