---
"@effected/github-actions": minor
---

## Breaking Changes

### `ActionLogger` neutralizes plain log text

`ActionLogger.layerLogger` writes `Effect.log*` text at `Info` and above as plain step output, and the runner reads every line of it. That text is now neutralized, so a message carrying `::add-mask::` or `##[` is no longer a workflow command. The same applies to the buffered transcript a step replays, the failure line `withStep` prints, and a detached `ActionOutputs.setFailed` message.

A program that deliberately wrote a command through `Effect.logInfo("::…")` must now use the service's own methods (`group`, `notice`, annotations, `setFailed`, `setSecret`), which are unaffected. `ActionLogger.layer` installs no logger of its own, so install both `ActionLogger.layer` and `ActionLogger.layerLogger` (as `Action.run` does) for log text to be neutralized.

## Features

- `WorkflowCommand` and `AnnotationProperties` moved to the new pure package `@effected/github-commands`, which this package now depends on. They are still exported from `@effected/github-actions`, so existing imports keep compiling. Import `CommandNeutralizer` from `@effected/github-commands` to defang text you write to the log by another route.
