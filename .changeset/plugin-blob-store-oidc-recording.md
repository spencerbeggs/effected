---
"@effected/ai-plugins": patch
---

## Documentation

* The Actions skills and the `effected-packages` references name the S3 blob backend `S3BlobStore.layer`, and teach `OidcTokenIssuer.recording()` without claims, `JwksResolver.layerUncoalesced` and `TestIssuer.make`'s `resolver` option
* Upgrade-ledger entries 0038 to 0041: `BlobStore.layerS3` became `S3BlobStore.layer`; `JwksResolver.layerUncoalesced`, `TestIssuer.make`'s `resolver` and `JwtKey.verificationOf`; `JournalFile`; and `OidcTokenIssuer.recording()` without claims
