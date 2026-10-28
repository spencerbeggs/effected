---
"@effected/cli": minor
---

## Breaking Changes

* `CliTest`'s `RunResult.exitCode` is now `number | null`, and `RunResult` gains `signal`. A child killed by a signal reports `exitCode: null` with the signal named. `SpawnedBin.exitCode` is `Effect<number | null>` and no longer fails after the default kill. Narrow on `null` where you read it.
* `Fmt.describe` and `Fmt.causeMessage` now delegate to `@effected/engine`'s `ErrorText`; their output is unchanged, but a custom copy should move to `ErrorText`.

## Features

### CliFormat

* `CliFormat.flag` takes aliases (map your names onto built-in formats, such as `human` to `auto`) and custom formats that are offered and yielded as themselves for the caller to render.
* `CliFormat.printJson` is the JSON half of `CliFormat.print` on its own, an `Effect<void>` with no requirement, so a CLI that keeps its own `--json` flag prints JSON the kit's way (#1128).
* `CliFormat.flag` offers `--format` only. A retired `--json` is not supported: a CLI that still accepts it keeps its own hidden `Flag.Boolean("json")` and maps it to the `json` format.

### Testing and suggestions

* `CliTest.spawn` starts a bin and returns at once with stdout and stderr line streams, `kill`, `exitCode` and `result`. Both streams replay to every reader and the child is killed when the scope closes (#1120).
* `RunOptions.forceKillAfter` (default 2 seconds) escalates to SIGKILL for a child that ignores SIGTERM.
* `Fmt.suggest` gives a did-you-mean list with `effect/cli`'s threshold (#1134), and `ConfigIssueRenderer` appends it to unknown-key lines (#1114).

## Bug Fixes

* `CliTest.spawn`'s `kill()` returns normally for a child that has already exited, on its own or at the same moment, instead of failing with `PlatformError`. A kill that fails on a child still running still fails, and `exitCode` and `result` still report how the child ended.
