---
"@effected/package-json": minor
---

## Features

* `PackageJsonFile` accepts `links: "follow" | "replace"`, forwarded to `AtomicFile.write`. The default is `"follow"`: a write through a symlink updates its target. `"replace"` replaces the link itself
