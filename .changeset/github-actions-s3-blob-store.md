---
"@effected/github-actions": minor
---

## Breaking Changes

* `BlobStore.layerS3(config)` is now `S3BlobStore.layer(config)`, from a module of its own like `GitHubCacheBlobStore.layer`. A bundler keeps a class's static members with the class, so the static put `@effected/crypto`'s `SigV4` in every bundle that named the `BlobStore` tag, S3 or not. A bundle naming only the tag fell from 672 KB to 347 KB, and one using only the GitHub cache backend from 788 KB to 667 KB, neither now carrying SigV4. Migrate with a rename: `S3BlobStore.layer` takes the same `S3Config` and has the same requirements

## Features

* `OidcTokenIssuer.recording()` takes its claims as optional. With none, it answers with placeholder claims for a push to `main` of `acme/example`, whose `aud` is the audience each call asked for, so a test that checks only the audience needs no `@effected/github` import to build an `ActionsOidcClaims`
