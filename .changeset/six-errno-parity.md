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
  (`Unknown`/`ERR_FS_EISDIR`) where it used to succeed, and removing a
  non-empty one without `recursive` fails the same way, not `BadResource`
  ("directory is not empty").
- `copy` of a file onto itself, or onto its own hard link, now **fails**
  `Unknown`/`ERR_FS_CP_EINVAL`; with `overwrite: true` it used to succeed
  as a no-op. A directory copied onto or into itself fails the same code,
  not `BadResource`.
- A `copy` kind mismatch (a directory onto a file, a file onto a directory,
  at the top or anywhere in the tree) now fails `Unknown` with
  `ERR_FS_CP_DIR_TO_NON_DIR` or `ERR_FS_CP_NON_DIR_TO_DIR` whatever
  `overwrite` says: it outranks the `overwrite: false` refusal, so the
  mismatch is reported where `AlreadyExists` used to be, and it replaces
  the `BadResource` an overwriting copy used to fail with.
- Renaming or removing a path written with a trailing `dir/`, a recursive
  `mkdir("/")`, a `glob` from a bad root (now matches `[]` instead of
  failing) and a negative `truncate` (now clamped instead of failing) now
  **succeed** where they used to fail.
- `utimes`' error `method` is now `"utime"`, matching the real platform.
- A NUL byte in a path now fails `BadArgument`.

A test asserting on the old tags or outcomes needs updating; a test that
already only checks the volume's behaviour against `@effect/platform-node`
directly is unaffected.
