---
"@effected/schemastore-cli": minor
---

## Breaking Changes

The CLI now runs under `CliRuntime.main`. Exit codes and stdout are unchanged, with one exception.

* `--wizard` is hidden from non-interactive help, and `build --wizard` in a non-interactive environment now exits 64 (usage error) instead of 0

## Features

* stderr leads with a glyph and the error tag, for example `✗ DriftError: …`, or `[FAIL]` under `TERM=dumb`
* When a failure happens inside a span, stderr adds an `in:` span trail
* stderr output is audience-aware, so humans, agents and CI each get the form suited to them
* A defect shows the program's own stack frames
