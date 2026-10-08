---
"@effected/cli": minor
---

## Breaking Changes

### `LiveOptions.drainPerformance` is removed

The option cleared React's development-build user-timing entries after every render. Ink 8, which the `ink` peer requires, brings `react-reconciler` 0.34, and that reconciler clears each measure as it records it, so the drain no longer did anything. It was also harmful: its `performance.clearMeasures()` was process-wide and wiped a program's own measures along with React's. `CliUi.live` now clears nothing.

Migration: delete `drainPerformance` from any `CliUi.live` or `CliUiTest.live` options. Nothing replaces it, and nothing is needed.

## Features

### Truncate and wrap options on `Doc.lines`

`Doc.lines(lines, options?)` now takes `{ truncate?, wrap? }`, applied to every entry exactly as `Doc.line` applies them. `wrap: false` keeps each entry whole, `truncate` cuts to the width with an ellipsis (and wins over `wrap`), and markdown output keeps entries whole. The `Lines` block gains optional `truncate` and `wrap` fields.

## Bug Fixes

* `useTerminalSize` now shares a single stdout `resize` listener per stream, however many components follow the size. This covers `DocView`, `Viewport`, `Tabs`, `Select`, `MultiSelect`, `Confirm`, `TextInput`, `Toggle`, `KeyHelp` and `CliUi.live`. Previously each component added its own listener, so a screen mounting 10 or more `DocView` rows printed Node's `MaxListenersExceededWarning` into the Ink frame. There is no API change.

## Documentation

* `CliUiTest.session` now documents that each run of a `CliUi.live` view counts as a mount for `next` and `mounts`.
