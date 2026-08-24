---
"@effected/github-actions": minor
---

## Breaking Changes

### Four error classes split into per-reason tagged unions

`DetachedProcessError`, `CacheKeyError`, `BlobEnvelopeError` and `ActionOutputError` were each a single `Schema.TaggedError` with a `reason` field. Each is now a **type alias for a union of dedicated error classes**, one per reason — so a value missing a field the reason requires (a pid, a path) is a compile error instead of a message rendering `"undefined"`.

```ts
// before
if (error.reason === "invalidPid") { ... }

// after
if (error._tag === "InvalidPidError") { ... }
```

| Old shape | New members |
| :--- | :--- |
| `DetachedProcessError` | `DetachedLogUnavailableError`, `DetachedSpawnFailedError`, `InvalidPidError`, `DetachedSignalFailedError`, `DetachedNotReadyError` |
| `CacheKeyError` | `CacheKeyReadError`, `CacheKeyBadPatternError` |
| `BlobEnvelopeError` | `NotABlobEnvelopeError`, `TruncatedBlobEnvelopeError`, `UnsupportedBlobEnvelopeVersionError`, `BlobMetadataDecodeError`, `BlobMetadataEncodeError` |
| `ActionOutputError` | `RunnerFileUnavailableError`, `RunnerFileWriteError`, `InvalidOutputNameError`, `OutputEncodeError`, `DetachedOutputError` |

The union type names (`DetachedProcessError`, `CacheKeyError`, `BlobEnvelopeError`, `ActionOutputError`) are unchanged and still exported, so a signature typed against them keeps compiling — only a narrowing `switch`/`if` on `.reason` needs to move to `._tag`.

### `Blob<A>` renamed to `StoredBlob<A>`

`BlobStore`'s stored-value interface is now `StoredBlob<A>`. Update any import or type annotation referencing `Blob`.

### `ToolInstallerError.subject` is now required

Previously optional, `subject` is now a required field on `ToolInstallerError` — every construction site must name what failed.

## Features

* `ActionInput.pairs` now rejects a line with an empty key (`=value`, or a bare `=`) unconditionally — an empty key silently produced `{ "": v }`, which could turn into a filter matching nothing with no diagnostic. Pass `{ requireValue: true }` to additionally reject a line with an empty value (`key=`); by default an empty value is still accepted as a legitimate empty string.
* `CacheKey.withNamespace` — prepends a namespace segment (e.g. a cache-bust token) to a key.
