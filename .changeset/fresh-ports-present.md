---
"@effected/copilot-plugin": minor
---

## Features

Brings the Copilot port level with the Claude Code plugin's interactive CLI kit teaching.

### `effect-v4-cli` teaches the presentation layer

- The skill now covers `@effected/cli` as the presentation boundary: the one wiring (`CliAudience.flags()` on the root, `CliAudience.run`, `CliRuntime.main` with `env`), audiences, the theme, documents and renderers, failure reports, `CliLog`, prompts, Ink screens and live views. It also covers testing with `CliEnv.layerTest`, `TestTerminal` and `CliUiTest`.
- New references: `presentation.md`, `prompts-and-screens.md` and `live-view.md`. `output-and-logging.md`, `exit-codes.md`, `recipes.md` and `testing-a-cli.md` are updated to match.
- New gotchas: `FORCE_COLOR` beats `NO_COLOR`, `TERM=dumb` is not interactive, an agent audience never gets an escape, and `CliRuntime.main` without `env` never prompts.

### `effected-packages` covers 36 packages

- New rows, references and construct tables for `@effected/env` and `@effected/github-commands`, and the index lists the `./ui` and `./ui/testing` subpaths. The `@effected/cli` and `@effected/github-actions` entries are updated for the presentation layer and the `WorkflowCommand` move.

### Other skills

- `actions-reporting` lists `CommandNeutralizer` for writing text you did not author to the log, and notes that `WorkflowCommand` now comes from `@effected/github-commands`.
- `effect-v4-idioms` adds two rules: resuming an async effect runs the fiber on the caller's stack, and clearing a reference and closing its scope must be one uninterruptible step.
- `effect-v4-services-layers` notes that a service class is itself an Effect, with no `.asEffect()`.
- `effect-v4-testing` adds `PubSub` drain traps (`shutdown` drops the untaken tail; `end`'s final message is sticky) and sweeping `Scheduler.MaxOpsBeforeYield` to expose races.
- The session-start orientation describes the wider `@effected/cli` scope.

## Bug Fixes

- The `effected-packages` memfs reference now states that a handle's mutators join relative paths to `root` unnormalized: `..` resolves after links are followed, as `writeFileSync` does.
