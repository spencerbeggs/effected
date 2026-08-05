---
"@effected/commands": patch
---

## Bug Fixes

`Run.jsonLine` now scans stdout lines from the end and takes the first line that both parses as JSON and decodes under the schema, instead of requiring the last non-empty line to decode. A child that writes after its payload — for example a pnpmfile hook logging from `process.on("exit", ...)` — no longer displaces the payload and fails the parse.

* Noise is tolerated on both sides of the payload; any run whose last non-empty line decodes behaves exactly as before
* When multiple lines decode, the last one wins — shape consumer schemas as a discriminated envelope (a required `ok` literal) so accidental log lines cannot satisfy them
* When nothing decodes, the typed `CommandOutputError` keeps its near-miss diagnostics: kind `schema` with the last JSON-parseable line's decode failure as `cause` when at least one line parsed, kind `notJson` only when no line anywhere was JSON — exit code and both redacted streams still carried as context
