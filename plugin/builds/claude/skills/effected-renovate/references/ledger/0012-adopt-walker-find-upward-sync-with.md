---
id: "0012"
title: "@effected/walker: Walker.findUpwardSyncWith climbs to the nearest directory an accept function takes"
kind: adopt
shows: none
applies:
  "@effected/walker": ">=0.26.0"
detect: ["BuildModuleInfoFs", "SessionEnvFileSystem"]
closes: ["spencerbeggs/effected#1181"]
---

Offer this to the user; never apply it unasked. It replaces a hand-rolled climb that reads each candidate and keeps going when it does not parse, such as the nearest *valid* `package.json`, along with the small read-only file port kept beside the walker's for it.

- **`Walker.findUpwardSyncWith(dirs, accept, options?)`** takes the directories to try, nearest first, and an `accept` that answers an `Option` for each. It answers an `Option` of the accepted `dir` and its `value`.
- **`options.cache`** is a caller-owned memo per directory. A `Map` satisfies it, which keeps the search cheap on a hot path.
- **`WalkerSyncFileSystem.readFile`** gives `accept` its read, so code that walks and then reads needs one port.
- A throwing `accept` propagates, so return `Option.none()` for a candidate that does not parse.

A port with a public shape of its own may have outside callers, so check that before removing one. Read the installed `.d.ts` for the exact shapes.
