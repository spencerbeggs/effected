---
"@effected/ai-plugins": patch
---

## Documentation

* The walker package reference documents the `"special"` `SkippedLink` kind, a link to a device, FIFO or socket
* The memfs package reference documents `MemoryFileSystem.special` and its `ENXIO` rule
* New upgrade-ledger entries for the widened `SkippedLink` kind, including the `if`/`else` branch the compiler does not catch, and for memfs's special seed entries and widened port shapes
