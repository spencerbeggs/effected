---
"@effected/git": minor
---

## Features

### `Git.log`

Adds `Git.log(cwd, { paths?, follow?, limit?, firstParentDiffMerges? })`, the commit walk as typed `CommitLogEntry` values — sha, both dates decoded to `DateTime.Utc`, the author identity, and the paths each commit touched. Scope it with a pathspec, walk a single path across renames with `follow: true` (git requires exactly one path for this, refused pre-spawn otherwise), and give merge commits a path listing with `firstParentDiffMerges`.

```ts
const entries = yield* git.log(cwd, { paths: ["src/"], limit: 20 });
```

An unborn `HEAD` and a pathspec no commit ever touched both resolve to the empty listing rather than a failure. `Git.log` takes no ref, so `UnknownRefError` — which every other `Git` read carries — is absent from this method's error union by construction (#627).

`GitCommand.log` exposes the same call as a pure, inspectable `Command` value.
