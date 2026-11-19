---
"@effected/cli": minor
---

## Features

### `--watch` on build commands

`effected package build` and `effected action build` take `--watch`: the build reruns whenever a source file or `effected.toml` changes, until interrupted.

```sh
effected package build --watch
effected action build --watch
```

* A failed rebuild is reported and the watch keeps running.
* Under `--format json` each build reports as JSON Lines.
* A line on stderr names the changed paths before each rebuild.
* Exit codes: `2` for a wrong directory at startup, `3` when the watcher stops, `130` on interrupt, and `64` under CI, where a watch would never end.
