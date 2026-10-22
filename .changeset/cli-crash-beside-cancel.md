---
"@effected/cli": patch
---

## Bug Fixes

- `CliUi.run` no longer reports a cancel when a screen crashed in the same tick as the cancel and a finalizer also failed. The run fails with the crash and the finalizer's defect only, as it does when no finalizer fails.
