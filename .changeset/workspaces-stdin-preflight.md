---
"@effected/workspaces": minor
---

## Features

### Standard input for `runBin` and `runCarrierBin`

`RunBinOptions.stdin` accepts a string, bytes or a byte stream and feeds it to the child process. When omitted, the child sees end of input.

### `PackedInstall` preflight and gate

- `PackedInstall.preflight(options)` reports `{ ready, missing }` for the build output a packed-install check needs.
- `PackedInstall.gate(preflight)` turns that report into an effect yielding `{ action, message }`, where `action` is `run`, `skip` or `fail`. It reads CI through `Config` and fails under CI, so a missing production build never silently skips the check.
