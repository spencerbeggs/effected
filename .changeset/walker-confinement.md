---
"@effected/walker": minor
---

## Breaking Changes

* `WalkerSyncPath` now needs `sep`, `dirname`, `resolve` and `isAbsolute` as well as `join`. `node:path` already satisfies it; hand-written doubles must add the three members.
* A relative `descend` `cwd` now dies (Effect form) or throws (sync form). Pass an absolute path, for example `path.resolve(cwd)`.
* `confineReal` now refuses every dangling symlink, including one that points back inside the root, because its target cannot be checked.

## Features

* `Walker.ascendToMarker` stops at the nearest directory holding a marker entry and probes nothing above it.
* `Walker.findUpwardAll` returns every hit in the nearest directory so a caller can report an ambiguity.
* Sync twins for every upward IO form and for `ascend`, built on one shared upward machine with the Effect forms.
* `descend` gains `match` (`file`, `directory` or `any`).
* `confineReal` and `confineRealSync` check containment physically, segment by segment, refusing symlink escapes and unresolvable paths. `PathEscapeReason` gains `outside` and `unresolvable`, and `PathEscapeError` gains an optional `cause`.

Closes #1116, #1117, #1129, #1136.

## Bug Fixes

### Security

* `confineReal` refuses dangling links, which a link swapped in after the check could otherwise redirect outside the root.
* Win32 drive-less rooted paths (`\repo`, `/repo`) are refused in the `descend` cwd, in `confineReal` base and candidate, in `stopAt`, and in the `ascendWithin` ceiling, instead of being read as inside the current drive's root.
