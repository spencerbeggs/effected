---
"@effected/sbom": minor
---

## Breaking Changes

`IdentityToken`, `IdentityTokenError` and `IdentityTokenShape` are no longer exported from `@effected/sbom`. They moved to `@effected/oidc`, which now owns the OIDC identity-token contract; `SigstoreSigner` still consumes it. Change the import:

```ts
import { IdentityToken, IdentityTokenError } from "@effected/oidc";
```
