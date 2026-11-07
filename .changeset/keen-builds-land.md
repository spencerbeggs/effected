---
"@effected/engine": minor
---

## Features

* Adds a `./build` subpath with `BuildRun` and `ActionRun`, the engine side of package and action builds, and their result classes `BuildRunResult` and `ActionRunResult`; it also re-exports the bundler's `ActionValidation`, whose `isCI` answers the CI question the way `@effected/env` does
