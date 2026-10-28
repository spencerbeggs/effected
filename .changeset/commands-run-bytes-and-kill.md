---
"@effected/commands": minor
---

## Features

* `Run.bytes` returns a command's stdout undecoded, NULs and invalid UTF-8 kept, with `Run.text`'s exit, timeout and capture semantics. Redaction scrubs stderr and errors, never the returned bytes.
* `Run.setKillOptions` is a dual combinator that sets `killSignal` and `forceKillAfter` on any command, pipelines and `ResolvedTool` commands included. `forceKillAfter` bounds a timeout against a tool that ignores SIGTERM.
* `LocalExec.command(launcher, binary, args, { kind, cwd })` builds a ready core command from the canonical prefix table; an empty or flag-like binary throws.
* `RunOnce` gains a serialize-only `mode`: every caller runs the work in turn under the lock and no done marker is read, trusted or written.

Closes #1138.
