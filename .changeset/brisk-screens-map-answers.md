---
"@effected/cli": minor
---

## Breaking Changes

Several behaviours change in ways a consumer can observe. Check each against your own output and tests.

* A human whose output is piped now gets unbounded width: output is no longer wrapped at 80 columns. Use `Doc.line` with `{ wrap: false }` to opt a single line out of wrapping elsewhere
* The span trail on a failure now defaults to `"app"`, so spans from kit packages are hidden. Set the spans option to `"all"` to restore the full trail, or `"off"` to drop it
* `Counter.label` is now a union (a plain string or `{ one, other }`), so code that reads it must narrow it first
* A share headline that read `1/2 change` now reads `1/2 changes`; update any snapshot that pinned the old text
* `TextInput.step` now moves the cursor and deletes by grapheme rather than by code point
* A status vocabulary's glyph is sanitised wherever it is drawn, so control sequences in a glyph no longer reach the terminal
* Inside a `CliUiTest` session, live views never render in Ink debug mode. stdout and stderr stay two streams (`stdoutWritten` / `stderrWritten`), merged in write order by `written` and `transcript`, and `CliUiTest.live` no longer aliases stderr to stdout. The harness mounts at `maxFps` 1000
* The internal `themeForAudience` helper was removed; use `CliTheme.forAudience`

## Features

### Screens and live views

* `CliUi.map` maps a screen's answer to another value (#907)
* `CliUi.lazyView` loads a live view on demand and accepts either the view itself or a `{ default }` module. `LiveOptions.final` prints a final document for non-interactive runs, where `render` is never called (#908)

### Text and prompts

* `TextInput` takes a `mask` option: `true`, a replacement string, or a predicate over the value. A predicate mask latches on until the value is emptied, and masks and cursor movement work per grapheme (#916)
* `Doc.line` accepts `{ wrap: false }` to keep a line on one row (#911)
* `Doc.counter` labels can be `{ one, other }`, and a share headline reads its plural form by the total (#919)

### Audience-aware output

* `CliTheme.forAudience` applies the audience rule to a theme, so an agent never gets an escape sequence. `CliLog.status` logs a status line on the diagnostics channel with its glyph painted through that rule and its text sanitised, with an optional `indent` (#918)
* The failure span trail is configurable with `"app" | "all" | "off"`, `env.appModule` names the application's own module, `env.spansEnvVar` lets an environment variable choose the mode, and `FailureDetails.lines` exposes the rendered lines. An `Effect.fn` call and its `X (definition)` frame now show as one `X` entry (#920)

### Testing

* `CliUiTestSession` exposes `transcript`, `written`, `stdoutWritten`, `stderrWritten`, `stdoutTranscript` and `stderrTranscript`, plus `renderPath` (#917)
* The new `@effected/cli/ui/testing/serializer` subpath ships a snapshot serializer for Vitest's `snapshotSerializers` (#909)

## Bug Fixes

* A `lazyView` whose module has no view fails with a clear error, latches per view and warns once
* A `CliLog.status` numeric indent is clamped to 64 spaces
* `appModule` matches Windows span paths, and a kit companion's own spans are kept
* Ink's frame throttle no longer races the test harness's settle step
