---
"@effected/cli-kit": minor
---

## Features

* `UsageErrorDetails.flag(f)`, available in `CliRuntime.main`'s `renderUsageError`, reads a local flag's value on the failing command path through the same core-parser probe that `setting` uses. Use it for a subcommand whose `--format` accepts different choices than the shared setting, since two settings cannot share a flag name on one command tree. Closes #1435.
