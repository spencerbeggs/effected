---
id: "0005"
title: "@effected/walker: WalkerSyncFileSystem requires readFile, so a hand-written sync port must add it"
kind: breaking
shows: typed
applies:
  "@effected/walker": ">=0.26.0"
detect: ["WalkerSyncFileSystem", "WalkerSyncOps", "readDirectory[[:space:]]*:"]
closes: ["spencerbeggs/effected#1181"]
---

`WalkerSyncFileSystem` has a required `readFile` member: it takes a path and answers the file's text, decoded as UTF-8 with links followed. Absent paths and directories throw node-shaped `ENOENT` and `EISDIR` errors, like the port's other members.

- **A hand-written port**: add the member. `readFileSync(path, "utf8")` is the Node form. No walk calls it, but the type requires it.
- **`nodeWalkerFileSystem` and a `@effected/memfs` handle's `sync` port** already satisfy the interface. Change nothing where a repository only passes one of those.
- **`readDirectory:` hits that are not walker ports**: ignore them. That pattern is there to catch a port written inline with no annotation.

The compiler finds every site. Check the member's shape against the installed `.d.ts`.
