---
"@effected/walker": minor
---

## Features

* `Walker.ascendWithin(start, ceiling, options?)` ascends bounded by a physical ceiling: it stops at the nearest ancestor whose real path equals the ceiling's. `ceiling` is an `Option<string>`, and `Option.none()` ascends exactly as `Walker.ascend(start)` does. Use it with ceilings such as the answer from `Git.repoRoot`, which `ascend`'s lexical `stopAt` never matches when `start` is reached through a symlink, letting the walk run silently to the filesystem root.

## Documentation

* `AscendOptions.stopAt` now documents that it matches lexically, not physically.
* The README states that `descend` and `compileAndExpand` are free functions, not `Walker` statics.
