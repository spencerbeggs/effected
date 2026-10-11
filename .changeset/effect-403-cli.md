---
"@effected/cli": minor
---

## Features

* `CliTheme.promptTheme` sets core `Prompt.Theme` `colors` from the kit's own colour decision, so prompts and the wizard are byte-clean at colour level `none` and never re-read `process`.

## Documentation

* `CliEnv` and `CliRuntime` TSDoc no longer tell bins to pass `process.stderr.isTTY`; the option is an override.

## Tests

* New tests prove core's deferred terminal-input acquisition. `gateTerminal` and `gateWizard` are kept.

## Dependencies

| Dependency | Type           | Action  | From  | To     |
| :--------- | :------------- | :------ | :---- | :----- |
| effect     | peerDependency | updated | 4.0.2 | ^4.0.3 |
