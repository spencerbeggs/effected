---
"@effected/jsonl": minor
---

## Features

* `JournalFile` on `@effected/jsonl/node` reads a journal file synchronously over `node:fs`, with no Effect runtime, for hooks, monitors and plugin builds that cannot ship the service. Both methods return a `Result`, failing `JournalNotFound` or the filesystem's `PlatformError`, and never throw
* `JournalFile.readFromResult(path, cursor?)` returns the complete lines appended since a saved `JournalCursor`, holds back a torn final line until its newline lands, and reads again from the start with a `reset` of `truncated`, `replaced` or `rewritten` when the file shrank, was renamed over or was rewritten in place. The cursor is a plain JSON record, and its offsets are the same logical byte offsets the `Journal` service reports
* `JournalFile.lastValidResult(events, path, window?)` returns the journal's current state the way the service's `latest` reads it: bounded windows back from the end, widening only while none holds a valid envelope. The README's runtime-free example now uses it in place of a hand-rolled tail read
