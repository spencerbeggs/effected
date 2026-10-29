---
"@effected/git": minor
---

## Features

* Added `Git.diffFile(cwd, ref, path, options?)`, which returns the patch text of one file, working tree against `ref`. `--no-color --no-ext-diff --no-textconv` are pinned so user git config cannot change the bytes.
* An unchanged file yields `""`. A path found neither at the ref nor in the index fails with the new `FileNotFoundError`; pass `{ allowMissing: true }` to get `""` instead. An unresolvable ref fails `UnknownRefError`.
* `diffFile` accepts `ignoreRepositoryEnv` like `repoRoot`, so it is safe inside a git hook.
