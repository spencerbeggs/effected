---
"@effected/workspaces": minor
---

## Features

* `SourceBoundary` has a new `{ promiseInExclusive }` rule that flags `Effect.promise(`, `Effect.runPromise(` and `Effect.runPromiseExit(` inside a `<lane>.run(` call, where the lane is bound from `Exclusive.make` in the same file or named in `lanes` (#1202). Core's `Effect.promise` abandons the promise when the lane's timeout interrupts the body, so the permit is released while the work still runs; `Exclusive.promise` aborts and waits. Offences report the rule as `"promiseInExclusive"`.

The check is lexical: a helper called from the body, an aliased `Effect` import or a member receiver such as `this.lane.run(` passes.
