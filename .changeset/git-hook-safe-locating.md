---
"@effected/git": minor
---

## Features

* `repoRoot`, `commonDir` and `treeIdentity` take `GitLocateOptions`. With `ignoreRepositoryEnv`, git's `--local-env-vars` are dropped from the child environment, so a hook's inherited `GIT_DIR` no longer reports the cwd as the toplevel (#1123).
* `GitFile.parse` and `parseResult` read a worktree or submodule `.git` pointer file by git's own rules, with a typed `GitFileParseError` (#1137).

## Documentation

* `GitRemote.parse` keeps its no-trim contract; the TSDoc now says to trim first, since git treats surrounding whitespace as significant.
