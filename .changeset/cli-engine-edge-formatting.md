---
"@effected/cli": minor
---

## Breaking Changes

* `FailureDetails` gains a required `exitCode`, a type break for code that builds the literal itself. A `render` hook reads the tag from the `error` argument it already receives.
* `env.displayPath` now reaches `Doc.print`, live-view frames, a live view's `final` document and `CliUi.context`, not only the failure report. Paths in normal output change if you set it.
* cli now depends on `@effected/engine` and `@effected/commands` as regular dependencies. `MainOptions.distribution` provides engine's `CurrentDistribution` and appends the carrier to `--version`.

## Features

* `Fmt` gains `pad`, `stripAnsi`, `isEscapeOnly`, `ranges`, `describe` and `causeMessage`.
* `CliUi.routeStream` routes a foreign stream line by line above a live view, and `CliUi.liveDetached` hosts a live view from code not built on Effect, with `render` allowed to be an Effect resolved under the same env layer.
* `CliLog.parseLevel(text)` returns an `Option<LogLevel>`.
* `CliRuntime.main` accepts `exitCodes` and `displayPath: { relativeTo }`.
* `CliFormat` provides a shared `--format` flag paired with `Doc.print`.

## Bug Fixes

* `CliFailure.toDoc` never throws: an error whose `stack`, `message`, `cause`, `issue` or `_tag` getter throws renders with that part missing.
* `Fmt.width`, `Fmt.truncate` and `Fmt.sanitize` recognize two-byte escapes and DCS/SOS/PM/APC strings.
* `CliLog.parseLevel` rejects inherited keys such as `constructor`.
