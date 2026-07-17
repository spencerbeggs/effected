---
"@effected/git": minor
---

## Features

`GitCommandError` now carries a `kind` discriminant that separates a pre-spawn guard rejection from a genuine git failure. `"refused"` means a pre-spawn guard (an option-like ref) rejected the invocation before any process spawned; `"failed"` means git actually ran and exited non-zero, or the spawn itself failed. Composed retry and fallback logic can route on the discriminant instead of parsing the `detail` prose.

* `Git.fetchAny` drops its duplicated up-front guard and short-circuits a refused ref by routing on `error.kind === "refused"`, with identical behavior
