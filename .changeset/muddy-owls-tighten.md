---
"@effected/package-json": minor
---

## Bug Fixes

### `PackageManager.FromString` version parsing is now strict

`PackageManager`'s `version` field is now `@effected/semver`'s `SemVer.PinnableVersionString` (an exact SemVer 2.0.0 version, no build metadata, no surrounding whitespace), and `integrity` is `@effected/npm`'s `CorepackIntegrityHash` — the same two schemas `@effected/npm`'s `PackageManagerPin` consumes, so the two no longer drift independently.

This is a deliberate strictening of what `PackageManager.FromString` accepts. Previously-accepted malformed input now fails typed at decode instead of being silently parsed:

* A leading-zero version component (`pnpm@01.2.3`)
* A leading-zero or empty prerelease identifier (`1.2.3-01`, `1.2.3-a..b`)
* A padded version substring (`pnpm@ 10.33.0`) — previously canonicalized by trimming, now a typed failure naming the version component

This matches corepack's own `semver.valid` check (minus its trim). The generated `.d.ts` is unchanged — a `Schema.check` is erased from the built type — so nothing here is visible at compile time; a manifest that previously round-tripped one of the inputs above will now fail to decode.
