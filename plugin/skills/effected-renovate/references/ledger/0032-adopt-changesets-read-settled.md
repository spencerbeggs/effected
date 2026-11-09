---
id: "0032"
title: "@effected/changesets: PendingChangesets.readSettled reports a bad changeset file instead of failing the whole read"
kind: adopt
shows: none
applies:
  "@effected/changesets": ">=0.2.0"
detect: ["PendingChangesets\\.read(Sync)?\\("]
changesets: ["settled-changesets-read"]
closes: ["spencerbeggs/effected#1306"]
---

Offer this to the user; never apply it unasked. It fits a caller that catches any `PendingChangesets.read` or `readSync` failure and treats it as "no pending bumps", which hides every good changeset behind one bad file.

`PendingChangesets.readSettled(root)` and `readSettledSync(root)` read `.changeset/` as `read` and `readSync` do, and answer `{ changesets, failures }`. Each failure is `{ file, error }`, with `error` the typed `ChangesetParseError` or `PlatformError`. Only a directory that cannot be listed fails them, and a missing one answers empty. The sync form answers a `Result`.

- Build the pending bumps from `changesets`, and report or log each entry of `failures`.
- Keep the strict `read` where versioning correctness depends on every file, as a release plan does.
- The name is `readSettled`, after `Promise.allSettled`, not the `readAll` the ticket suggested.

Read the installed `.d.ts` for the exact shapes.
