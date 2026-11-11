---
"@effected/walker": minor
---

## Bug Fixes

### Dot-segment spellings answer only when they resolve physically

A level-0 magic walk answers through a spelling only if the path resolves on disk. `f.js/../*.js`, and `link/e/..` without `followSymlinks`, now answer nothing, where they answered through a file or an unfollowed link. Under `followSymlinks`, only a `..` after a link needs a real directory, so `link/./*.js` resolves through the link.
