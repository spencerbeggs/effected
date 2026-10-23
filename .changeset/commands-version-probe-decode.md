---
"@effected/commands": patch
---

## Bug Fixes

- `VersionJson` tool-version probes decode stdout through Schema instead of `JSON.parse`, and follow only own properties, so a polluted prototype can no longer answer as a version.
