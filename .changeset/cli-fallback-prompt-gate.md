---
"@effected/cli": patch
---

## Bug Fixes

- `CliPrompt.fallback` and `CliUi.fallback` answer with `otherwise` again in a run that is not interactive, such as a piped agent or CI run. Core skips a `withFallbackPrompt` fallback entirely when its `TerminalCapabilities.canPrompt` is `false`, which lost the default and exited `64`. `CliInteractive.layer` and `CliInteractive.layerTest` now hold core's `canPrompt` open, so the kit's own interactivity decision governs. A `TerminalCapabilities` with `canPrompt: false` provided inside the program bypasses the kit's fallbacks.
- `CliEnv.layer` and `CliEnv.layerTest` install core's `TerminalCapabilities` from the kit's `TerminalEnv`, so core's built-in help colour follows the kit's colour rule, where `FORCE_COLOR` wins over `NO_COLOR`.
