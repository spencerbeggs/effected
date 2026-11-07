---
id: "0011"
title: "@effected/walker: PosixPath is a synchronous posix path value that never reads the working directory"
kind: adopt
shows: none
applies:
  "@effected/walker": ">=0.26.0"
detect: ["posixPath"]
closes: ["spencerbeggs/effected#1191"]
---

Offer this to the user; never apply it unasked. It replaces a local copy of core's posix path code, kept because pure code cannot put `Path` in `R`.

`PosixPath` is a root export, a static class with `sep`, `join`, `normalize`, `relative`, `dirname`, `basename`, `extname` and `isAbsolute`. It is ported from core's posix implementation.

It has no `resolve`, on purpose. `relative` throws on a question only a working directory could answer, such as one absolute and one relative path, so check what a local copy answers there before swapping it in. Code that has `Path` in `R`, or that needs the host's separator, keeps core's `Path`.

Read the installed `.d.ts` for the exact shapes.
