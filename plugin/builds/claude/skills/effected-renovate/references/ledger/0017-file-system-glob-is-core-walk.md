---
id: "0017"
title: FileSystem.glob is core's own walk on every platform
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["\\.glob\\("]
---

`FileSystem.glob` is now core's own walk on every platform, derived from `readDirectoryEntries`. On a case-insensitive volume (APFS by default), a **wildcard** segment matches stored names case-sensitively, while a **literal** segment is looked up and keeps the queried spelling. Probed on APFS with `NodeFileSystem`: `*.JSON` matched `docs.json` before and matches nothing now; `Sub/*.TS` likewise; `sub/*.ts` gives `sub/A.ts` on both. Patterns use `/` separators and backslash escapes, and Node extglobs no longer expand (changelog).

What to change: write each wildcard in the case the files are stored in, or match case-insensitively yourself over a broader pattern. Replace any extglob with plain alternatives.

How it shows itself: a glob that silently returns fewer files, often only on macOS. Only tests find it. `@effected/memfs` follows the same rule (entry 0037).
