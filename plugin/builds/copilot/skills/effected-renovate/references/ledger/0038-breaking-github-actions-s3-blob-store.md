---
id: "0038"
title: "@effected/github-actions: BlobStore.layerS3 is now S3BlobStore.layer"
kind: breaking
shows: typed
applies:
  "@effected/github-actions": ">=0.38.0"
detect: ["BlobStore\\.layerS3"]
changesets: ["github-actions-s3-blob-store"]
---

The S3-compatible blob backend moved off the `BlobStore` service class onto its own `S3BlobStore` class, beside `GitHubCacheBlobStore`. `BlobStore.layerS3` no longer exists, so every hit is a type error.

- **Where a hit calls `BlobStore.layerS3(config)`**, call `S3BlobStore.layer(config)` instead, imported from `@effected/github-actions`. It takes the same `S3Config` and has the same requirements (`HttpClient`, `ActionOutputs`, core `Digest.Digest` and `Mac.Mac`); nothing else about the backend changed.
- **Why it moved:** a bundler keeps a class's static members with the class, so the static put `@effected/crypto`'s SigV4 into every bundle that named the `BlobStore` tag, including an action that used only the GitHub cache backend. After upgrading, such a bundle is smaller and no longer contains `AWS4-HMAC-SHA256`. If the repository checks its bundle size, expect it to drop.

Check the installed `@effected/github-actions` `.d.ts` for `S3BlobStore`. Verify with the typecheck.
