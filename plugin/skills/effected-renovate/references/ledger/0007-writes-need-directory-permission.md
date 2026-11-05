---
id: "0007"
title: "PackageJsonFile, ConfigFile, ManagedSection and schema output now write atomically and refuse a read-only target"
kind: behaviour
shows: behavioural
applies:
  "@effected/package-json": ">=0.30.0"
  "@effected/config-file": ">=0.25.0"
  "@effected/templates": ">=0.18.0"
  "@effected/schemastore": ">=0.30.0"
detect: ["(PackageJsonFile|ConfigFile|ManagedSection)\\."]
---

These writers now go through `@effected/files`' atomic write: a temp file beside the target, then a rename over it. Three things follow, and only a test or a run finds them.

- **The directory must be writable**, not just the file. A directory a process can read but not write now fails, where an in-place write used to succeed.
- **A read-only target is refused.** A target without write permission fails the write instead of being overwritten.
- **Symlinks and modes are kept, the inode is replaced.** A symlinked target is written through to its destination and keeps its link. File mode survives. Code that holds the file by inode (a watcher, a hard link, an open handle) sees a new file after each write.

Run a test that writes through each hit against a read-only fixture and a symlinked one. In tests built on `@effected/memfs`, inject a permission fault rather than stubbing the file system.
