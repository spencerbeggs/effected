---
"@effected/engine": minor
---

## Features

* `ErrorText` (`describe`, `causeMessage` and `of`) is the never-throwing error-text rendering that used to live in `@effected/cli`. `of` is the `causeMessage ?? describe` fallback. `cli` and `mcp` both build on it now (#1141).
