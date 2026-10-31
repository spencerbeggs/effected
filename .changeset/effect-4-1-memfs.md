---
"@effected/memfs": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### readDirectoryEntries and core's glob

The memory volume and `@effected/memfs/node-sync` implement `FileSystem.readDirectoryEntries`, and the volume's `glob` is now core's derived one; memfs's own matcher is gone. On a case-insensitive volume (`caseSensitive: false`), a wildcard segment matches stored names case-sensitively, so `*.JSON` no longer finds `docs.json`, while a literal segment still folds and keeps the queried spelling. A fault injected on `readDirectoryEntries` now also fails `glob`; a fault on `readDirectory` does not, so a test that must fail every listing faults both. On a case-sensitive volume, check any test asserting a glob's exact result order.
