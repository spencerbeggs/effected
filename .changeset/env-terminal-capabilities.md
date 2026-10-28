---
"@effected/env": minor
---

## Features

- `TerminalEnv.colorLevelFrom(env, isTTY)` reads a colour level from an environment record and a TTY flag, with no `Stdio` service and no Effect runtime. It applies the same rule as `TerminalEnv.layer`: `FORCE_COLOR` first, then `NO_COLOR`, `NODE_DISABLE_COLORS` and `TERM=dumb`, then the terminal table.
- `TerminalEnv.capabilities(terminal, term?)` projects a `TerminalEnv` snapshot into core's `TerminalCapabilities` value: `canColor` from the kit's colour rule, `canAnimate` from stdout being a terminal, and `canPrompt` from both stdin and stdout being terminals. `TERM=dumb` clears animation and prompting.

Closes #1139
