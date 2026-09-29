---
"@effected/memfs": minor
---

## Features

* `MemoryFileSystem.die(defect)` is a fault handler that fails a member as a defect, which `Effect.catch` cannot absorb.
* `makeFaulty`, `layerFaulty` and `layerFaultyWith` accept a `(base) => faults` factory as well as a fault map. `base` is the unfaulted volume, so a handler can rewrite arguments and delegate to it. The factory type is exported as `MemoryFileSystemFaultsFactory`.
