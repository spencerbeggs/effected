---
"@effected/github-actions": minor
---

## Features

* `Action.run` honours step debugging: when `RUNNER_DEBUG=1`, it lowers `References.MinimumLogLevel` to `Debug` for the whole program, so `Effect.logDebug` from the action or any library it calls renders as a `::debug::` line. It only ever lowers the level, so a `layer` that sets `Trace` keeps it. Opt out with `Action.run(program, { stepDebugLogLevel: false })`.
