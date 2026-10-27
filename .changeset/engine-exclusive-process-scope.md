---
"@effected/engine": minor
---

## Features

* `Exclusive` runs a handler under a one-permit, uninterruptible-once-started gate with a required timeout. `Exclusive.promise` takes `abandon: true` for a promise that ignores its abort signal; the default aborts and awaits.
* `ProcessScope` (`chdir`, `env`) restores process state on every exit.
* `LaunchContext.usable` and `LaunchContext.resolve` share one guard that rejects empty and unsubstituted `${…}` values.
* `withDistribution` and `withDistributionVersion` wrap a hand-wired program with the distribution carrier.
