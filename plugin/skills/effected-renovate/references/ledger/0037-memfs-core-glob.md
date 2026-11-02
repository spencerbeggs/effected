---
id: "0037"
title: The memory filesystem uses core's glob and readDirectoryEntries
kind: behaviour
shows: behavioural
applies:
  "@effected/memfs": ">=0.22.0"
detect: ["caseSensitive: *false", "layerFaulty", "(^|[^A-Za-z])faults([^A-Za-z]|$)", "\\.glob\\("]
---

`@effected/memfs` follows core's new `FileSystem` (entries 0005 and 0017) rather than keeping its own matcher.

- **The memory volume implements `readDirectoryEntries`, and its `glob` is core's derived one.** On a case-insensitive volume (`caseSensitive: false`, the APFS-shaped one), a wildcard segment now matches stored names case-sensitively, as on the host: `*.JSON` no longer finds `docs.json`. A literal segment is still looked up, so it folds and keeps the queried spelling (`sub/*.ts` gives `sub/A.ts`). This matches `NodeFileSystem` on APFS. On a case-sensitive volume, check any test that asserts a glob's exact result order.
- **Fault injection reaches `glob` through `readDirectoryEntries`.** A fault on `readDirectoryEntries` now fails a `glob` too, as a fault on `access` fails `exists`. A fault on `readDirectory` does not reach `glob`, so a test that must fail every listing faults both.
- **`@effected/memfs/node-sync`** implements `readDirectoryEntries` over `readdirSync(…, { withFileTypes: true })`, with `readDirectory`'s error mapping. Its `glob` stays an unsupported defect. Additive.

How it shows itself: only tests find it, as a glob on a case-insensitive volume returning fewer paths, or a fault suite whose glob now fails or now succeeds.
