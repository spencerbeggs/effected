---
"@effected/walker": minor
---

## Features

### Confining untrusted relative paths

`confineRelativeResult(base, candidate)` keeps an untrusted relative path, such as an archive entry or an asset path from a manifest, under `base`. It runs synchronously and returns a `Result<string, PathEscapeError>`. `confineRelative` is the `Effect` twin. Closes #592.

Both `/` and `\` count as separators. The check refuses each of these and records why on `PathEscapeError` as a `PathEscapeReason`:

- a NUL character
- an absolute form: POSIX `/x`, UNC `\\server\share`, win32 `C:\x` or `C:x`
- a `..` that climbs above `base` after normalisation (`og/../x` is accepted, `og/../../x` is not)
- a path that names `base` itself (`""`, `.`, `og/..`)
- a segment win32 reserves: a `:`, a name made only of dots and spaces, or a device name such as `CON` or `nul.txt`

On success the value is `base` joined with the normalised path. The check is lexical: it does no IO, does not percent-decode, and does not resolve symlinks.
