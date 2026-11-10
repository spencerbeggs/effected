---
"@effected/bundler": minor
---

## Features

### A worker can be its own table

`ActionEntries.workers` accepts a plain source string or an `ActionWorker`, so a worker can carry settings beside its source. The string form is unchanged.

```toml
[action.entries.workers]
plain = "src/plain.ts"

[action.entries.workers.guarded]
source = "src/guarded.ts"
importCheck = false
```

`importCheck = false` skips the post-build load check for that worker alone, for one that exits at import by design. `[action.build] importCheck = false` still turns the check off for every bundle.

## Breaking Changes

The type of `ActionEntries.workers` widens from `Record<string, string>` to a record of `string | ActionWorker`. Code that reads a worker value as a string narrows it first.
