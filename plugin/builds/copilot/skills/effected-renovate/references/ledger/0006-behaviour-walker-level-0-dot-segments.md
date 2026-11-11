---
id: "0006"
title: "@effected/walker: a magic pattern's leading dot segments answer only when they resolve on disk"
kind: behaviour
shows: behavioural
applies:
  "@effected/walker": ">=0.28.0"
detect: ["[A-Za-z0-9_*}-]/\\.\\.?/[^[:space:]]*\\*"]
changesets: ["walker-dot-segments"]
closes: ["spencerbeggs/effected#1290"]
---

A walk joins paths, which folds `.` and `..` lexically, while a kernel resolves them physically. The walker now answers through a magic pattern's leading `.`, `..` or empty segment only when that spelling resolves on disk.

- `f.js/../*.js`, where `f.js` is a file, answers nothing. It used to answer the files beside `f.js`.
- Without `followSymlinks`, a spelling that passes through a link, such as `link/e/../*.js`, answers nothing.
- Under `followSymlinks`, a link may be passed through, and a `.` after one names its target, so `link/./*.js` answers through the link. A `..` after a link still needs a real directory, because the kernel resolves it from the link's target.

Where the search matched a pattern with a `.` or `..` segment after a name, check what that name is on disk. A pattern that reached files through a file or an unfollowed link now answers nothing: rewrite it without the dot segment (`f.js/../*.js` is `*.js`), or set `followSymlinks` where crossing a link was intended. Most hits are relative imports or plain paths and need nothing.

Run the tests that walk such patterns, and compare the walk's answer before and after on a real tree.
