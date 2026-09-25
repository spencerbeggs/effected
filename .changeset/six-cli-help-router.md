---
"@effected/cli": minor
---

## Features

- `CliRuntime.main`'s new `helpOnUsageError` option reroutes a usage error's
  help document to stderr, beside the error itself, instead of core's
  default of printing it to stdout. `"stdout"` keeps core's behaviour (the
  default); `"stderr"` keeps stdout clean for a caller that parses it, such
  as a hook piping JSON through `jq` — an unknown flag, a bad value or an
  unknown subcommand then writes nothing to stdout. An explicit `--help` and
  a bare invocation of a command group still print to stdout: neither is an
  error.

- `ReportFailuresOptions.render` now receives a second argument,
  `FailureDetails`, carrying the whole `Cause` the program failed with and
  `isDefect` — whether the reported error is a defect (a `die`, a thrown
  exception, a bug) rather than a typed failure from the error channel. A
  renderer can use it to render a typed failure as one line and a defect as
  a full report, without guessing from the error's shape. A renderer that
  takes only `error` still fits.
