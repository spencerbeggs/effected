---
"@effected/memfs": minor
---

## Features

* The sync interface gains `realPath`, which resolves links and throws `ENOENT`, `ENOTDIR` or `ELOOP` with `syscall: "realpath"`. A memfs handle now satisfies walker's sync port directly.
