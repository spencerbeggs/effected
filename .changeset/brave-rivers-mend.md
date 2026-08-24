---
"@effected/git": minor
---

## Features

`configList` and `configGet` accept a new `scope` option (`{ scope: "local" }`) to read only the checkout's own declared configuration instead of the merged (repository + global + system) view. Passing both `scope` and `file` (on `configList`) fails typed as a `GitCommandError` rather than silently preferring one — git itself accepts only one source selector. `configSet` is unaffected: it always writes repository-local config and offers no scope option, deliberately, to avoid leaking a setting onto a shared machine or CI runner.
