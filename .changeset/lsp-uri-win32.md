---
"@effected/lsp": minor
---

## Features

* `LspUri.toPath` and `LspUri.fromPath` convert file URIs to paths and back. `toPath` answers `Option.none()` for a non-file scheme or a URI that names no path on the platform, instead of throwing as `fileURLToPath` does. `fromPath` writes RFC 8089 URIs, dot segments never climb above a root, drive or UNC share, and the drive letter is lowercase both ways (#1127).

## Bug Fixes

### Security

* Win32 device and stream paths are refused: `toPath` answers `None` and `fromPath` throws a `TypeError` for DOS device names (`CON` to `LPT9`, `CONIN$`, `CONOUT$`, any extension), a `:` after the drive (alternate data streams), and trailing dot or space segments. `\\??\` paths and non-hostname UNC servers are refused too.
* A `file://%6Cocalhost/a` host is no longer percent-decoded, so it answers `None`. `\\localhost\share` round-trips as `file:////localhost/share/x`.
