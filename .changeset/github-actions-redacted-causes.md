---
"@effected/github-actions": minor
---

## Bug Fixes

* `CacheKey.matchingFiles` and `hashMatching` accept a relative `workspace` again, resolved against the process working directory; the returned paths, and a `CacheKeyReadError`'s `path`, are absolute. Digests are unchanged.

### Security

* Credentials are scrubbed from kept HTTP error causes: the OIDC, blob store, cache, artifact, Twirp and `ToolInstaller` errors keep redacted copies, and `ToolInstallerError.subject` is the redacted URL.
* `BlobTransferError.cause` is a redacted `RestError` copy, so a SAS URL is no longer readable from it.
