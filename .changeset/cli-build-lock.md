---
"@effected/cli": minor
---

## Features

### `effected package build` waits for a concurrent build

When another build of the same package holds its lock, the command prints one line on stderr naming the holder and the lock path, so `--format json` keeps a single document on stdout. If the lock is held for the whole wait, the command exits `3`, the infrastructure tier, instead of racing the other build.
