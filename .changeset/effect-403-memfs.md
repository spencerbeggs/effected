---
"@effected/memfs": minor
---

## Features

* `FileSystem.open` honours `noFollow`: a final-component symlink fails with `BadResource` (`ELOOP`), matching Node. `wx` on a link stays `EEXIST`, and parent links are still followed.
* `File.read` and `File.readAlloc` honour `{ position }`: they read at the offset and leave the cursor untouched. A negative position fails with `BadArgument`.

## Tests

* 13 new differential cases run against the real Node layer.

## Dependencies

| Dependency | Type           | Action  | From  | To     |
| :--------- | :------------- | :------ | :---- | :----- |
| effect     | peerDependency | updated | 4.0.2 | ^4.0.3 |
