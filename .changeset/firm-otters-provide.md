---
"@effected/workspaces": patch
---

## Dependencies

| Dependency       | Type       | Action | From | To          |
| :--------------- | :--------- | :----- | :--- | :---------- |
| @effected/semver | dependency | added  | —    | workspace:^ |

## Bug Fixes

- Added the missing `@effected/semver` dependency. `@effected/lockfiles@0.4.0` added `@effected/semver` to its non-optional peerDependencies, but the 0.11.0 release did not add it to this package's own dependencies (it added `@effected/npm` and `@effected/yaml` but missed this one), so the peer bubbled up unmet to every consumer and `pnpm peers check` failed downstream.
