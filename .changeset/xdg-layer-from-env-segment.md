---
"@effected/xdg": minor
---

## Features

* `Xdg.layerFromEnv(record)` builds an `Xdg` layer from an env record, fresh per call.
* `AppDirs.segment(name)` returns a filesystem-safe path segment as a `Result`, mapping `@org/pkg` to `@org__pkg` and rejecting `""`, `.` and `..` with an `AppDirsSegmentError`.
