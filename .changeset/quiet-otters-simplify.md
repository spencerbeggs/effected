---
"@effected/github-actions": patch
---

## Performance

- `CacheKey.matchingFiles` now walks the workspace with `@effected/walker` instead of enumerating every entry: each include pattern is expanded from its own literal prefix (a literal include costs one `stat`, never a walk), matching only files, with nothing pruned implicitly (parity with the runner's `hashFiles()`). An absent `workspace` still fails typed.
- `Artifact.upload` and `Artifact.download` each spawn their archiver (`zip`/`unzip` on Linux/macOS, `Compress-Archive`/`ExtractToDirectory` on Windows) once, reading its output and exit code from that single spawn — the same pattern `ActionCache` and `ToolInstaller` already used.
- `ManagedDocument` scans a document's text once per instance instead of re-scanning on every region accessor.

## Bug Fixes

- `ActionState.save` refuses a key that cannot open a `GITHUB_STATE` heredoc block (one containing a line break) with a typed `writeFailed` error instead of writing a value that corrupts every entry after it — the same guard `ActionOutputs` already enforced.
- `BlobStoreError` with `reason: "refused"` from the GitHub-cache `BlobStore` backend now carries a `detail` field naming the RPC method, matching the cache and artifact errors, which already did.
