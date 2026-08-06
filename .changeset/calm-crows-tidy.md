---
"@effected/workspaces": patch
---

## Bug Fixes

- Removed the unused `@effected/semver` dependency from the published manifest. Nothing in the package imports it — the tracking-tag grammar deliberately parses version segments itself, as its own documentation states — so consumers no longer install `@effected/semver` through this package.
