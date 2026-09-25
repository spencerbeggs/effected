---
"@effected/memfs": minor
---

## Breaking Changes

Every failure the volume raises now matches the shape `@effect/platform-node`
gives it: node's errno rides on `reason.cause.code`, and the `_tag` is
derived from that code by the node adapter's own mapping (`ENOENT` →
`NotFound`, `EEXIST` → `AlreadyExists`, `EISDIR`/`ENOTDIR`/`ELOOP` →
`BadResource`, everything else — `EINVAL`, `ENOTEMPTY`, `EBADF`, `EPERM` and
more — `Unknown`). Several tags change as a result, and several outcomes
that used to fail now succeed:

- `readLink` on a non-link now fails `Unknown`/`EINVAL`, not `BadResource`.
- `link` targeting a directory now fails `Unknown`/`EPERM`, not
  `PermissionDenied`.
- `mkdir` through a path that passes through a file now fails
  `BadResource`, not `AlreadyExists`.
- A closed or wrong-mode file handle now fails `Unknown`/`EBADF` or
  `Unknown`/`EINVAL`, not `BadResource`.
- Removing an empty directory without `recursive` now **fails**
  (`Unknown`/`ERR_FS_EISDIR`) where it used to succeed.
- Renaming or removing a path written with a trailing `dir/`, a recursive
  `mkdir("/")`, a `glob` from a bad root (now matches `[]` instead of
  failing) and a negative `truncate` (now clamped instead of failing) now
  **succeed** where they used to fail.
- `utimes`' error `method` is now `"utime"`, matching the real platform.
- A NUL byte in a path now fails `BadArgument`.

A test asserting on the old tags or outcomes needs updating; a test that
already only checks the volume's behaviour against `@effect/platform-node`
directly is unaffected.
