---
"@effected/changesets": minor
---

## Features

### A settled read of `.changeset/`

`PendingChangesets.readSettled(root)` and `readSettledSync(root)` read `.changeset/` as `read` and `readSync` do, but a file that does not read or parse is reported instead of failing the whole read.

* They answer `{ changesets, failures }`, where each failure is `{ file, error }` and `error` is the typed `ChangesetParseError` or `PlatformError`
* Only a directory that cannot be listed fails them. A missing directory answers empty
* `read` and `readSync` are unchanged: keep them where versioning correctness depends on every file
* New exported types: `PendingChangesetFailure` and `SettledChangesets`
