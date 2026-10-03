---
name: supply-chain-attestation
description: Use when generating a CycloneDX SBOM, checking NTIA minimum elements, building an in-toto statement or a SLSA provenance predicate, signing into a Sigstore DSSE bundle, or uploading an attestation to GitHub.
when_to_use: Sbom.generate, NtiaReport, InTotoStatement, SlsaProvenance, SigstoreSigner, OidcTokenIssuer, ActionsProvenance, ActionsIdentityToken, Attestation.upload
---

# Supply-chain attestation

The end-to-end pipeline spans **three packages**, which is why it is one
skill rather than a single API reference: `@effected/sbom` (the SBOM
emitter, the statement/provenance models, the signer), `@effected/github-actions`
(the OIDC token the signer needs), and `@effected/github` (the REST
upload). None of the three packages import each other for this — the seams
are the point. General Effect v4 service/layer and schema rules live in
`effect-v4-services-layers`, `effect-v4-schema`, `effect-v4-testing`,
`effected-packages`; this skill states only the supply-chain instance.

`@effected/sbom` is two independent capabilities wearing one package:
emitting an SBOM is pure computation over a manifest, and signing is
network-bound cryptography against Fulcio and Rekor. Every rule below
exists to keep an SBOM-only consumer from reaching Sigstore's transport,
and vice versa.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `Sbom.generate`, `.toJson`, `.write` | `import { Sbom } from "@effected/sbom"` | Emitting a CycloneDX SBOM document |
| `SbomMetadataSource` | `@effected/sbom` | Deriving metadata/purl/root component from a package manifest |
| `NtiaReport` | `@effected/sbom` | Checking the seven NTIA minimum elements against a document |
| `InTotoStatement`, `InTotoSubject`, `Sha256Digest` | `@effected/sbom` | Building an in-toto statement over a validated subject digest |
| `SlsaProvenance` | `@effected/sbom` | Building the SLSA provenance predicate |
| `ActionsProvenance` | `import { ActionsProvenance } from "@effected/github-actions"` | Capturing SLSA provenance from the runner's OIDC claims |
| `IdentityToken`, `ActionsIdentityToken`, `OidcTokenIssuer` | `@effected/sbom` / `@effected/github-actions` | Wiring the workload identity token a signer needs |
| `SigstoreSigner` | `@effected/sbom` | Signing a statement into a Sigstore DSSE bundle |
| `Attestation.upload` | `import { Attestation } from "@effected/github"` | Uploading a signed bundle to GitHub |

## Standards

- **Keep the three packages seamless in both directions.** Nothing in
  `@effected/sbom` imports `@effected/github-actions` or `@effected/github`
  for this pipeline, and nothing in them imports `@effected/sbom` — a
  consumer wires the pieces together at the composition root.
- **`generate`/`toJson` are total; `write` is the only fallible member.**
  Treat any error surfacing from emission itself as a sign an error channel
  crept back in that the model's validation should have made unreachable.
- **Leave `supplier`/`authors`/`timestamp` explicit, never derived from the
  manifest.** A manifest says who wrote the software, not who supplied it,
  assembled the BOM, or when — deriving any of the three fabricates an
  NTIA element.
- **Let `NtiaReport.compliant` stay a derived getter, not a gate.** A
  caller wanting a hard failure writes its own `Effect.fail` at its own
  boundary; the report itself always succeeds.
- **Build provenance through `ActionsProvenance.capture`, never by
  hand-mapping OIDC claims yourself.** The hand mapping is eleven
  same-typed string renames wide enough to transpose two fields and sign a
  wrong attestation without a type error catching it.
- **Ask the identity-token contract for a token; never take one as a sign
  parameter.** The Sigstore audience constant is Sigstore's requirement,
  not the caller's — keep it inside the contract, not spread across call
  sites.
- **Wire the shipped `ActionsIdentityToken` adapter inside Actions; never
  hand-roll it.** Outside Actions, supply a token you already hold through
  the static layer instead of reimplementing the contract.
- **Never introduce a namespace object over this package's exports.** A
  convenience `Sbom = { generate, sign }` object would make every SBOM-only
  consumer reachable to Fulcio's transport, silently.
- **Cross the `sbom` ↔ `github` attestation seam as a structural JSON
  value, never as a shared class.** `Attestation.upload` types its bundle
  parameter `unknown` on purpose — there is no edge between the two
  packages in either direction.

## Footguns

- A license is an expression field, and CycloneDX renders it as three
  different shapes depending on whether it's a catalog identifier, an
  expression, or neither — emitting every value as an identifier produces
  a document that looks right and fails validation. See
  [`references/sbom-and-ntia.md`](references/sbom-and-ntia.md).
- The purl's scope is the purl **namespace**, not part of the name — a
  naive `encodeURIComponent` on the whole package name collapses the
  namespace-separating slash and parses back wrong.
- An unwitnessed Sigstore bundle has **no** `tlogEntries` key at all
  (protobuf JSON omits empty repeated fields) — reading its length blindly
  throws on a legitimately unwitnessed bundle.
- Audit every ported error channel for whether it can actually fire — this
  package deleted three that existed only because a since-removed
  dependency might have thrown.

## Additional resources

- [references/sbom-and-ntia.md](references/sbom-and-ntia.md) — SBOM
  emission mechanics, `SbomMetadataSource`'s explicit-only fields, the
  license/purl rendering traps, and the ported-error-channel audit. Load
  when: emitting a document or debugging a license/purl field.
- [references/signing-and-provenance.md](references/signing-and-provenance.md) —
  `InTotoStatement`/`SlsaProvenance` construction, the `IdentityToken`
  contract inversion and its Actions adapter, `SigstoreSigner`'s bundle
  mechanics, the upload seam, and the testing recipes specific to signing.
  Load when: building a statement, wiring identity tokens, signing, or
  testing any of it.
- [references/bundler-notes.md](references/bundler-notes.md) — the
  reachability-confinement rules for `@sigstore/*` and `Package`, the
  comment-stripping order trap, and why `@cyclonedx/cyclonedx-library` is
  absent (and when that reverses). Load when: auditing a dependency
  decision or debugging a reachability-suite result.

## Related skills

`actions-runtime`, `actions-state-and-secrets`, `github-api` and
`release-and-publish` cover the surrounding runner, state, REST-client and
release-composition concerns this pipeline plugs into.
