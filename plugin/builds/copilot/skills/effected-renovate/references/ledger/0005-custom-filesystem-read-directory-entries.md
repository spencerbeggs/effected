---
id: "0005"
title: A custom FileSystem must implement readDirectoryEntries
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["FileSystem\\.make\\(", "readDirectory *:"]
---

A hand-built `FileSystem` must now implement `readDirectoryEntries`, which lists a directory with each entry's type (`"Unknown"` is allowed). `FileSystem.make` now derives `glob` from it and no longer accepts a `glob`: apply a custom one afterwards, `FileSystem.FileSystem.of({ ...FileSystem.make(impl), glob })`. A wrapper that changes `readDirectory` must change `readDirectoryEntries` the same way, or listings and globs disagree.

How it shows itself: the compiler rejects an implementation missing the member, or one passing `glob` to `make`.

A test double of `FileSystem` is better replaced by `@effected/memfs`, which already implements the member. Check the shape against the installed `effect/dist/FileSystem.d.ts`.
