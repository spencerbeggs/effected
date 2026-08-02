# @effected/sbom

## 0.2.1

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/package-json | dependency | updated | 0.6.1 | 0.7.0 |

## 0.2.0

### Features

* `Package`, `Person` and `Repository` are now re-exported from
  `@effected/sbom`'s entry point, sourced from `@effected/package-json`. A
  caller can name `SbomMetadataSource.fromPackage`'s parameter type without
  adding `@effected/package-json` as an undeclared dependency:

  ```ts
  import { Package, SbomMetadataSource } from "@effected/sbom";

  const supplier = (pkg: Package) => SbomMetadataSource.fromPackage(pkg);
  ```

  `SbomMetadataSource.fromPackage`'s remarks now name `@effected/package-json`
  as the source of the `Package` type it accepts. [#191][#191]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/package-json | dependency | updated | 0.6.0 | 0.6.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.1.0

### Features

* First release. Software supply-chain artifacts as Effect schemas: a CycloneDX
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
  elements from an SBOM. [#180][#180]

### Dependencies

| Dependency             | Type       | Action  | From  | To    |
| ---------------------- | ---------- | ------- | ----- | ----- |
| @effected/package-json | dependency | updated | 0.5.2 | 0.6.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180
