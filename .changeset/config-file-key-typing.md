---
"@effected/config-file": patch
---

## Bug Fixes

* `ConfigFile.layer` and `ConfigFile.testLayer` now reject a key whose service shape is wider than `ConfigFileShape` at compile time, instead of accepting it silently. Calls that pass the type arguments explicitly keep compiling.
