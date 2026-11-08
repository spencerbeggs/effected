---
"@effected/workspaces": minor
---

## Bug Fixes

* `PnpmSettings.load` fails with `PnpmSettingsError` reason `"membership"` when the `packages:` patterns each compile but not together as a set

## Breaking Changes

`PnpmSettingsError.reason` gains `"membership"`. An exhaustive switch on `reason` needs the new case.
