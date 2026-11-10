---
id: "0052"
title: "A custom cluster MessageStorage must implement deleteProcessed"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.3"
detect: ["MessageStorage\\.(make|makeEncoded)\\(", "MessageStorage\\.Encoded"]
---

This applies to code that implements `effect/cluster`'s `MessageStorage` itself, through `MessageStorage.make` or `MessageStorage.makeEncoded`, or by writing a `MessageStorage.Encoded` object. The new `MessageRetention.make` deletes a persisted entity's old completed requests, and it calls a new required `deleteProcessed` member on the storage (Effect-TS/effect#10267). The SQL and in-memory storages that ship with Effect already implement it.

- **Add `deleteProcessed` to every custom storage.** It takes the entity type, a cutoff (`completedBefore`) and a `limit`, and answers how many processed requests it deleted. A storage that keeps nothing can answer `Effect.succeed(0)`, which is what Effect's no-op storage does.
- SQL message storage on MySQL now needs MySQL 8.0.1 or later, or MariaDB 10.6 or later, with `binlog_format` set to `ROW` or `MIXED`. Check your database before you deploy.

Check the installed `effect/cluster/MessageStorage` `.d.ts` for the exact `deleteProcessed` signature. Verify with your typecheck.
