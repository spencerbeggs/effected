---
"@effected/mcp": minor
---

## Features

* `action_build` gains `check`: builds and compares against the committed output without writing, reporting drift. It ignores `persist`.
* `action_init` gains `local`, scaffolding a local-only action (workspace base, no package `dist`).
* The new bundler errors (`PersistPathError`, `CheckUnavailable`, `NoOutput`, and check drift) are refused with a message that names what to change.
* The tool descriptions name the configured persist directory.
