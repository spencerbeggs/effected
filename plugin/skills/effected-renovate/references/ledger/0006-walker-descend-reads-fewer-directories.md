---
id: "0006"
title: "@effected/walker: descend reads only directories a match can lie in, which changes depth and unreadable failures"
kind: behaviour
shows: behavioural
applies:
  "@effected/walker": ">=0.26.0"
detect: ["descend(Entries)?(Sync)?\\(", "depthExceeded"]
closes: ["spencerbeggs/effected#1194"]
---

`descend`, `descendEntries`, `descendSync` and `descendEntriesSync` give the same matches and read fewer directories. A pattern with no globstar is never read below the depth its segments reach. Under `dot: false` a hidden directory is entered only when a segment names one. For `packages/*/README.md` the walk reads `packages` and `packages/a`, and leaves `packages/.hidden` and `packages/a/deep` unread.

A read the walk skips cannot fail it. Look for these three shapes at each hit:

- **`maxDepth` applies only to directories the walk reads.** `packages/*/README.md` under a cap of 1 succeeds on a deep tree. Going past the cap where a match could lie is still a typed `depthExceeded`. Rewrite a test or a guard that expected `depthExceeded` from a bounded pattern.
- **An unreadable directory out of the pattern's reach is not a failure.** Under `onUnreadable: "fail"` it does not fail the walk, and under `"record"` it is not recorded. Move a test's unreadable fixture to where a match could lie.
- **A test that counts reads** or spies on the port sees fewer of them. Update the expected list.

Then offer this to the user, and never apply it unasked: a hand-rolled walk that exists only to bound the reads can become `descend`. `maxDepth` is not needed for the bound.

Verify by running the tests that cover each hit.
