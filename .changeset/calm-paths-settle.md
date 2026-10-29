---
"@effected/walker": minor
---

## Features

* Added `relativeWithin(base, absolute)` and `relativeWithinSync`, answering the posix base-relative path of an absolute path that physically lies inside `base` as an `Option` (`""` for the base itself, `None` when outside or unverifiable). A path that does not exist yet is resolved from its deepest existing ancestor by default; pass `{ missing: "refuse" }` to answer `None` for any path that does not exist.
