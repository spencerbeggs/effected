---
"@effected/engine": minor
---

## Features

### A build of one package waits for another

`BuildRun.run` serialises builds of the same package on a lock under `.cache/effected/locks`, so a second build waits instead of cleaning `dist` under the first. A lock whose process is dead is reclaimed, and the lock is released on failure or interruption.

* `BuildLockHolder` describes the process holding the lock: its pid, working directory and start time
* `BuildLockOptions` sets how a build waits, and `BuildRunDeps.lock` carries it
* `BuildLockTimeoutError` is the failure when the lock is held for the whole wait
* `BuildProgress` gains a `Waiting` variant, sent to `onProgress` while the build waits, with the lock path and the holder as an `Option`

## Breaking Changes

`BuildRun.run` can now fail with `BuildLockTimeoutError`. A caller that handles the run's failures by tag adds that case; a `BuildProgress` consumer that matches exhaustively adds `Waiting`.
