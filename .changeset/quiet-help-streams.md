---
"@effected/cli-kit": minor
---

## Features

* `CliEnvOptions.helpFlags` and the `CliHelpFlags` type let a program choose which flags request help.
* `useStyle` gives Ink views access to the active style.
* `TestTerminal.make({ forbidInput })` builds a test terminal that fails if the program reads input.
* `CliTest.run` accepts `expectExit`, and failures surface as `CliTestFailure` so tests can assert on the exit code.

## Bug Fixes

* Help printed after a usage error on stderr now follows stderr's own terminal check, so colour and styling no longer depend on whether stdout is a terminal.
