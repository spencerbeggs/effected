---
"@effected/cli": patch
---

## Bug Fixes

- `CliRuntime.main` and `CliRuntime.reportFailures` report a handler failure that carries a `CliError.userMessage` once. `Command.runWith` renders any such failure itself and re-fails with it, and the kit printed a second `[FAIL] <Tag>` line after it. The failure keeps the exit code a handler failure gets: its `exitCodes` entry by tag, then `exitCode`, then `1`.
