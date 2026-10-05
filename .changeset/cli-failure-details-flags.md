---
"@effected/cli": minor
---

## Features

- `FailureDetails` gains the required `isCancelled` and `isNotInteractive` flags, so a render can skip the issue-report footer for a cancelled prompt. Code that builds a `FailureDetails` by hand must now supply both fields.

## Refactoring

- Code-span pipe escaping in table cells is reworked with no change in behaviour.

## Documentation

- The `helpOnUsageError` TSDoc names `env.formatter` as the formatter it uses.
