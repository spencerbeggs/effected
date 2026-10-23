---
"@effected/git": minor
---

## Breaking Changes

### `Git.status` lists untracked files individually

`Git.status(cwd)` now always passes `--untracked-files=<mode>`, defaulting to `all`. A wholly untracked directory that used to come back as one `?? dir/` entry now comes back as one `??` entry per file, and the caller's `status.showUntrackedFiles` git config no longer affects untracked files (other config, such as `status.renames`, still applies). `GitCommand.status()` argv gains `--untracked-files=all`.

**Migration:** pass `{ untrackedFiles: "normal" }` to keep the old directory-level listing.

## Features

- `GitShape.status` takes an optional second parameter, `{ untrackedFiles?: GitUntrackedFilesMode }`. Existing callers and hand-written `GitShape` implementations are unaffected.
- New type export `GitUntrackedFilesMode`: `"normal" | "all" | "no"`.
