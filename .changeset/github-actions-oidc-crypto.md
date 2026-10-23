---
"@effected/github-actions": minor
---

## Breaking Changes

### `OidcClaims` is removed

`OidcTokenIssuer.claims`, `OidcTokenIssuer.layerFor` and `OidcTokenIssuer.unsignedTokenFor` now use `ActionsOidcClaims` from `@effected/github`, the same class `ActionsOidc.verify` returns. Replace `OidcClaims` with `ActionsOidcClaims`; its fields are camel-cased (`jobWorkflowRef` where `job_workflow_ref` was) and its ids (`repositoryId`, `runId`, `runAttempt` and the rest) are integers rather than strings. A test double built with `layerFor` must now also supply `sub`, `aud`, `actor`, `actorId`, `repositoryOwner`, `exp` and `iat`.

### `BlobStore.layerS3` requires core `Crypto`

The S3 store now signs requests with `@effected/crypto`'s SigV4 and the package's private signer is gone. `layerS3` therefore needs core `Crypto` in its requirements; provide the platform's `Crypto` layer.

### `BlobStoreError` gains `invalidKey`

A key with a `.` or `..` path segment cannot be sent as signed, because every URL parser collapses those segments, so the S3 store now refuses it before sending with reason `invalidKey`. Code that switches exhaustively on `BlobStoreError.reason` must handle the new case.

## Bug Fixes

- A `BlobStore.layerS3` key containing `!'()*` is now requested at its encoded path: the store sends exactly the path and query that SigV4 signed, so they match what S3 sees.
- `ToolInstaller` reads the runner architecture from `RUNNER_ARCH`, mapping X86 to `ia32` and ARM to `arm`, instead of the process architecture.

## Maintenance

- S3 credentials pass through `Secret.mask`, and no trace headers are sent to the S3 store.
- Artifact expiry follows `Clock`, so a test clock controls it.
- Action inputs and external JSON are decoded with Schema.
- `node:crypto` is confined to `internal/digest.ts`, which closes #767.
