---
"@effected/mcp": minor
---

## Features

### `package_build` refuses when another build holds the lock

A call that finds another build of the same package running for the whole wait is refused with a message to wait and call again, or to delete the named lock file if no build is running. `PackageToolOptions.lock` sets how the build waits; omitted, the engine's default applies.

### Worker import checks in the tool descriptions

The `action_build` description and the server instructions say a worker's own `[action.entries.workers.<name>]` table can set `importCheck = false` to skip that worker's load check alone.
