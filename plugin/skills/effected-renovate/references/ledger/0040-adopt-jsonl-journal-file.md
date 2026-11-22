---
id: "0040"
title: "@effected/jsonl: JournalFile reads a journal file synchronously with no Effect runtime"
kind: adopt
shows: none
applies:
  "@effected/jsonl": ">=0.20.0"
detect: ["Envelope\\.lastValid", "readTail"]
changesets: ["jsonl-journal-file"]
---

Offer this to the user; never apply it unasked.

`JournalFile` on `@effected/jsonl/node` reads a journal file over `node:fs` with no Effect runtime, returning a `Result` instead of throwing (`JournalNotFound`, or the filesystem's `PlatformError`).

- **`JournalFile.lastValidResult(events, path)`** replaces a hand-rolled tail read (`openSync`/`readSync` of the last few KB, dropping the partial first line) fed to `Envelope.lastValid`. It widens its window the way the service's `latest` does, so `Option.none()` means the whole file holds no valid envelope.
- **`JournalFile.readFromResult(path, cursor?)`** replaces a hand-rolled incremental reader: it returns the complete lines appended since a saved `JournalCursor` (a plain JSON record whose offsets are the service's own), holds back a torn final line, and reads again from the start with a `reset` of `truncated`, `replaced` or `rewritten`. On any reset but `none`, drop the state built from earlier reads before applying the lines.

Only hits that read a file themselves are candidates: `Envelope.lastValid` over text the code already holds needs nothing. Check the installed `@effected/jsonl/node` `.d.ts` for the shapes.
