---
"@effected/app": patch
---

## Documentation

- The Effect v4 module index now flags core's `Crypto.digest` as **one-shot**: its signature takes the whole payload as a single `Uint8Array`, with no incremental/streaming form. Digesting a key, token, or short manifest fits; digesting a stream-sized artifact means buffering it all in memory, which is why the kit's `github-actions` `Artifact` and `PackageManagerInstaller` stay on `node:crypto` instead
