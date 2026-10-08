---
"@effected/cli": minor
---

## Features

### Truncate and wrap options on `Doc.lines`

`Doc.lines(lines, options?)` now takes `{ truncate?, wrap? }`, applied to every entry exactly as `Doc.line` applies them. `wrap: false` keeps each entry whole, `truncate` cuts to the width with an ellipsis (and wins over `wrap`), and markdown output keeps entries whole. The `Lines` block gains optional `truncate` and `wrap` fields.

## Bug Fixes

* `useTerminalSize` now shares a single stdout `resize` listener per stream, however many components follow the size. This covers `DocView`, `Viewport`, `Tabs`, `Select`, `MultiSelect`, `Confirm`, `TextInput`, `Toggle`, `KeyHelp` and `CliUi.live`. Previously each component added its own listener, so a screen mounting 10 or more `DocView` rows printed Node's `MaxListenersExceededWarning` into the Ink frame. There is no API change.

## Documentation

* `CliUiTest.session` now documents that each run of a `CliUi.live` view counts as a mount for `next` and `mounts`.
