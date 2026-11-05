---
id: "0013"
title: "NodeSyncFileSystem.layerWithPath provides the host's own Path"
kind: behaviour
shows: behavioural
applies:
  "@effected/memfs": ">=0.24.0"
detect: ["layerWithPath"]
---

`NodeSyncFileSystem.layerWithPath` used to pair the filesystem with core's POSIX-only `Path`. It now provides the host's own `Path`, so a program that reads both services sees Windows paths correctly beside the real filesystem.

Remove a hand-built `Path` layer that was provided next to it to work around the POSIX one. On a POSIX host nothing else changes; check tests that assert separators.
