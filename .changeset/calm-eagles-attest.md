---
"@effected/sbom": minor
---

## Features

First release. Software supply-chain artifacts as Effect schemas: a CycloneDX
1.6 SBOM, the NTIA minimum-elements report, in-toto statements and SLSA
provenance, and Sigstore DSSE signing.

### Generate and write an SBOM

`Sbom.generate` and `Sbom.toJson` are total, pure functions — no CycloneDX
library and no thrown-error surface to guard against; `Sbom.write` is the
package's only IO, over Effect's `FileSystem`. `SbomMetadataSource` derives
CycloneDX component data straight from a `package.json` (`fromPackage`,
`npmPurl`, `externalReferences`), reading a manifest as a type only so a
consumer that just wants an SBOM never links `@effected/package-json`'s IO.

### Signing is a separate, optional capability

`SigstoreSigner` is the **only** module that imports `@sigstore/*` — a
consumer that only wants an SBOM never reaches Fulcio's HTTP stack, asserted
structurally by the package's own reachability test. `IdentityToken` supplies
the OIDC identity token the signer needs; `SigstoreBundle` is the resulting
DSSE bundle as a plain structural value.

### Attestation formats

`InTotoStatement` and `SlsaProvenance` (SLSA Provenance v1) round out the
attestation predicate surface; `NtiaReport` derives the seven NTIA minimum
elements from an SBOM.
