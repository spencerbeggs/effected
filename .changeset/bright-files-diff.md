---
"@effected/git": minor
---

## Features

* Added `Git.diffFile(cwd, ref, path, options?)`, which returns the patch text of one file, working tree against `ref`. Color, external diff, textconv, the `a/` `b/` prefixes, relative paths, context length and the diff algorithm are pinned by flag, so the diff keys in user git config cannot change the bytes.
* An unchanged file yields `""`. A path found neither at the ref nor in the index fails with the new `FileNotFoundError`; pass `{ allowMissing: true }` to get `""` instead. An unresolvable ref fails `UnknownRefError`.
* `diffFile` accepts `ignoreRepositoryEnv` like `repoRoot`, so it is safe inside a git hook.
