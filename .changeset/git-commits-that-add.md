---
"@effected/git": minor
---

## Features

* `Git.commitsThatAdd(cwd, paths, options?)` finds the commit that added each path, replacing `@changesets/git`'s `getCommitsThatAddFiles`. It runs `git log --diff-filter=AC --follow --max-count=1` once per path, so a renamed file resolves to the commit that added it under its first name. The result is aligned with `paths`, each entry an `Option` of the commit sha; `Option.none()` means no commit in the history reachable from `HEAD` added the path.
* In a shallow clone the boundary commit is never credited. Git reports it as adding every file it contains, so a hit with no parents counts only once the repository is complete. By default the lookup fails with the new `ShallowHistoryError`, which names the unresolved paths.
* Deepening is opt-in through `deepen: { by, maxRounds, remote }`, because it fetches from the network and adds history to the clone. It retries the unresolved paths after each `git fetch --deepen=<by>` until they resolve, the clone becomes complete, or `maxRounds` rounds have run. `by` defaults to 50, as upstream deepens; `maxRounds` defaults to 20, where upstream has no limit.
* The path always goes after a literal `--`. A path that has since left the working tree therefore still resolves, where upstream returns `undefined`, and a path beginning with `-` is never read as an option.
* `GitCommand.addingCommit(path)` and `GitCommand.fetchDeepen(by, remote?)` build the two invocations. `fetchDeepen` masks a credential in a URL remote.
