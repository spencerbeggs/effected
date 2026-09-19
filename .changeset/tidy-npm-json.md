---
"@effected/npm": patch
---

## Bug Fixes

Fixed `PackagePublish.pack` and `dryRun` rejecting every `npm pack --json` result on npm 12, where `pack --json` emits an object keyed by package name instead of npm 11's array of entries. Both shapes now decode correctly.
