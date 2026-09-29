---
"@effected/git": minor
---

## Features

* `Git.commonDir(cwd)` and `GitCommand.commonDir()` return the absolute, symlink-resolved path of the git directory a repository shares with all of its linked worktrees, so two answers compare with `===`. It fails with `GitCommandError | NotARepositoryError` and needs git 2.31 or newer; an older git, which echoes the unknown flag and exits 0, fails as a `GitCommandError` instead of returning a wrong answer. Only git's trailing newline is removed, so a path ending in whitespace keeps it.

## Documentation

* `Git.repoRoot` now documents that its answer is physical: symlinks are resolved.
