---
"@effected/config-file": minor
---

## Features

* `ConfigResolver.upwardWalk` accepts a `ceiling`, a physical bound compared through `Walker.ascendWithin`, so a repo root read from `Git.repoRoot` bounds the walk even from a symlinked start. It cannot be combined with `stopAt`, whose lexical meaning is unchanged.
