---
"@effected/env": minor
---

## Features

* `ShellExports.quote` is exported: a one-word shell quoter for a caller that builds its own `export` lines. It has no POSIX-sh-only mode.

## Bug Fixes

* `ShellExports` now rejects `PIPESTATUS` as a special variable, like the other shell-managed names.
