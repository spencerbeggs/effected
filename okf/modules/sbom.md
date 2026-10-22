---
type: Module
title: sbom
description: The software-supply-chain artifact half of attestation — a CycloneDX 1.6 SBOM, the NTIA report, SLSA provenance and Sigstore DSSE signing.
status: stable
kind: package
resource: ../../packages/sbom
tags:
  - architecture
  - bundle
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-22T23:55:11Z
integrity:
  generated:
    body: 34203a4adbba217c
---

# sbom

## Purpose

`@effected/sbom` owns the software-supply-chain artifact half of
attestation: producing a CycloneDX 1.6 SBOM, reporting it against the NTIA
minimum elements, modelling in-toto statements and SLSA provenance, and
signing a statement into a Sigstore DSSE bundle. The attestation REST
surface belongs to [`github`](github.md); the mint-sign-build-attest
pipeline is consumer composition; this package owns the artifacts and the
signing.

Two capabilities live in one package and must stay independently
reachable. Generating and validating an SBOM is pure computation over a
manifest. Signing is network-bound cryptography against Fulcio and Rekor.
A consumer that only wants an SBOM must not pull the Sigstore stack into
its bundle, and a consumer that only signs provenance must not pull an
SBOM emitter — see [bundle reachability](#bundle-reachability).

## Tier and the dependency decision

Integrated tier, unavoidably: `@sigstore/sign` and `@sigstore/bundle` are
real external runtime dependencies with no honest way around them. The
design question is not *whether* to be integrated but how small the
integrated surface can be — one module,
`packages/sbom/src/SigstoreSigner.ts`, roughly 380 KB. See
[sbom owns its emitter](../decisions/sbom-owns-its-emitter.md) for the
declined `@cyclonedx/cyclonedx-library` alternative.

Kit edges: [`spdx`](spdx.md) for license identifier-versus-expression
classification on components (never a second SPDX engine), and
[`package-json`](package-json.md) for manifest-derived metadata — imported
as **types only** in the metadata module, so nothing in the emitter's own
graph links `package-json`'s IO. The one runtime link is the entry
point's re-export of `Package`, `Person` and `Repository`, because a
caller assembling components must be able to name its parameter type
without declaring an edge on a package it only touches through this one.
No `github` edge exists in either direction: a `SigstoreBundle` crosses
that seam as a structural JSON value
(`{ mediaType, verificationMaterial, dsseEnvelope }`), `github` types the
parameter structurally, and the consumer wires the two together — the
same call `github` makes for its subject digest versus lockfiles'
integrity hash, a small deliberate duplication in preference to dragging
a package across a seam.

## Module map

Module-per-concept; `packages/sbom/src/index.ts` re-exports only. There is
deliberately no `src/internal/`: the JSON normalizer sits in the module
whose serializer it is, git-URL normalization belongs to
[`package-json`](package-json.md), and purl encoding is public because a
caller assembling its own components or naming an in-toto subject needs
the same encoder.

| Module | Owns | Reaches |
| --- | --- | --- |
| `SbomDocument.ts` | the CycloneDX 1.6 model and its normalizing serializer | spdx |
| `Sbom.ts` | the emitter facade: `generate`, `toJson` (both total), `write` (the package's only IO, over core `FileSystem`) | `SbomDocument.ts` only |
| `SbomMetadataSource.ts` | derivation from a `Package` manifest plus explicit overrides, and the purl encoder | package-json (types) |
| `NtiaReport.ts` | the seven-element report | — |
| `InTotoStatement.ts` | statements, subjects, digests, predicate types | — |
| `SlsaProvenance.ts` | the typed SLSA Provenance v1 predicate and its GitHub-workflow constructor | — |
| `SigstoreBundle.ts` | the DSSE bundle value and its media types; imports nothing from `@sigstore/*` | — |
| `SigstoreSigner.ts` | the only module importing `@sigstore/*`: the signer service, its layers, `SigningError` | `@sigstore/*` |

`Sbom` and `SbomMetadataSource` are static classes with a private
constructor, not `as const` namespace objects, because an `as const`
object's member types are inferred in the built `.d.ts` and lose their
TSDoc; `static readonly` keeps it, with call syntax unaffected
(`Sbom.generate(...)`).

## Assembly is total; only IO can fail

Assembling a document and serializing it are plain functions with no
error channel. A predecessor typed them as effects that could only fail
because a CycloneDX library might throw — a failure mode introduced *by*
the dependency, not the domain. With an owned model whose inputs are
already-validated schema values, neither `generate` nor `toJson` can fail;
only `write` keeps an error channel, because the filesystem has one. Every
error channel is audited for whether it can actually fire: an
`Effect.try` around pure string interpolation in the provenance
constructor, and an NTIA check testing a field the model declares
required, were both deleted for the same reason — a channel that cannot
fire is worse than no channel, because it forces every caller to handle a
case that does not exist.

A license is an **expression** field, and the emitter picks between three
shapes: a catalog identifier emits `{license:{id}}` (the schema constrains
`id` to the SPDX enumeration), a valid expression like `MIT OR
Apache-2.0` emits the schema's one-element `{expression}` tuple, and
anything else (`UNLICENSED`, `SEE LICENSE IN …`) emits a named license.
The branches are exclusive because the expression tuple caps at one
element. This is where the [`spdx`](spdx.md) edge becomes real:
`License.isKnownId` and `isValidExpression` decide the branch, never a
local regex.

The purl encoder follows the package-url spec rather than intuition:
`encodeURIComponent(name)` collapses a scope's separating slash, but the
spec's own npm vector is `pkg:npm/%40angular/animation@12.3.1` — the scope
is the purl namespace, its `@` percent-encoded and the slash literal.
Versions pass through verbatim, because every character semver permits is
a legal RFC 3986 path character. Both are pinned against published
vectors.

## What a manifest cannot say

See [what a manifest cannot say](../limitations/what-a-manifest-cannot-say.md).

## The NTIA report

See [the NTIA report is not a gate](../decisions/ntia-report-not-a-gate.md).

## SLSA provenance

The predicate is a typed schema class, not a `Record<string, unknown>`,
and its GitHub-workflow constructor is total. There is no ambient
environment read: the server URL is a required field on the constructor's
input, so the constructor is a pure projection and the ambient read moves
to the caller — see
[`actions-attestation`](../interfaces/actions-attestation.md) for where
that caller lives. The build-type identifier stays in this package,
because it names a provenance shape rather than an Actions runtime
detail, and the constructor's input is a plain record, not a contract
service, since there is nothing to swap and no IO to invert.

The emitted shape is byte-compatible with what the upstream Actions
attestation toolkit produces, pinned by a fixture test with a deep-equal
so an extra field fails as loudly as a missing one — the fixture's claims
deliberately give the workflow ref and the job workflow ref **different**
values, because with them equal a constructor that confuses the two
passes every assertion. One divergence from upstream favours this
package: upstream reads its server URL with no default and writes the
literal string `undefined` into every URL it builds when the variable is
unset.

## Signing and the identity seam

`SigstoreSigner.sign(statement)` is the whole surface. The audience string
for Sigstore stays inside this package rather than becoming a caller
parameter, because it is Sigstore's requirement, not the caller's
knowledge. `IdentityToken` is an inverted contract: OIDC token issuance
belongs to the Actions runtime, and this package must not depend on
[`github-actions`](github-actions.md), since that package is integrated
with a required `@effect/platform-node` peer and taking the edge would
drag a platform peer into every SBOM consumer. The contract is declared
in [`oidc`](oidc.md), the kit's OIDC home (see
[the oidc package scope](../decisions/oidc-package-scope.md)), whose
`IdentityToken.ts` imports nothing but `effect`, so this package links
no JWT code by requiring it. `layerStatic` serves a consumer that already
holds a token; `github-actions` ships the implementing layer,
`ActionsIdentityToken` (see
[`actions-attestation`](../interfaces/actions-attestation.md)).

`SigningError`'s `kind` is chosen by reading Sigstore's own internal error
codes (`CA_*`, `TLOG_*`, `TSA_*`, `IDENTITY_TOKEN_*`) rather than guessed;
an unattributable failure is `kind: "bundle"` rather than assigned to a
step it may not belong to. There is no cause-chain-to-string flattener,
because `cause: Schema.Defect()` keeps the original structurally and such
a walk exists only to turn an error into a message. The bundle's media
type is carried through from the builder rather than declared as a
literal, since the builder picks a version depending on whether a
certificate chain is present. An unwitnessed bundle has no
`tlogEntries` key at all, because protobuf JSON omits empty repeated
fields.

## The attestation seam

This package produces a signed bundle; `github`'s attestation surface
accepts one. If `github` typed that parameter as this package's class,
`github` would depend on `sbom`; if this package performed the upload,
`sbom` would depend on `github`. Both are avoided because the bundle
crossing the seam is a serialized JSON value with a stable published
shape.

## Bundle reachability

The invariant: an SBOM-only consumer must not reach `@sigstore/*`, and a
signing-only consumer must not reach the SBOM emitter. Three mechanisms
hold it, in order of how load-bearing they are:

1. **One module imports `@sigstore/*`** — `SigstoreSigner.ts` — and
   nothing in the document, emitter, report, metadata or provenance
   modules names it, transitively or otherwise.
2. **Free-standing named exports, never a namespace object** — see
   [no barrel re-exports](../conventions/no-barrel-re-exports.md). A
   `Sbom = { generate, sign }` convenience object would make every SBOM
   consumer reachable to Fulcio's HTTP stack, silently.
3. **A reachability test with a control** —
   `packages/sbom/__test__/reachability.test.ts` walks the runtime import
   graph of `src` statically and asserts no `@sigstore/*` edge appears
   from the SBOM surface, **and** that the signer module does reach
   them, so the suite can fail. See
   [the bundle-reachability suite convention](../conventions/bundle-reachability-suite.md).

The suite constrains the **import** graph, not the **resolver** graph:
`@sigstore/*` is a declared runtime dependency of the whole package, so
it is installed wherever `sbom` is, and a bundler's resolver walks it
regardless. That distinction has a live consequence, not a theoretical
one: [`github-actions`](github-actions.md) depends on this package for
two small seam adapters
(see [`actions-attestation`](../interfaces/actions-attestation.md)), so
every consumer of `github-actions` installs `sbom`'s dependencies even
if it never signs anything. The claim this design supports is "a
consumer that does not import the signer links nothing from it, and a
tree-shaking bundler can drop it"; it does not support "the dependency is
absent from the consumer's tree by construction".

The reachability walker in this package's test suite strips **line**
comments before block comments, deliberately: the reverse order lets a
`/*`-containing token inside prose (this package's own doc comments
mention `` `@sigstore/*` ``) open a phantom block comment that deletes
everything up to the next doc comment, imports included — reported here
as a module that imports `effect` appearing to import nothing. See
[the bundle-reachability suite convention](../conventions/bundle-reachability-suite.md).

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. The DSSE
bundle builder takes a signer and a witness by interface, so a test
supplies a stub signer returning a fixed key and certificate and a stub
witness returning a canned log entry — no network, no keys, no OIDC — and
the code under test is the **real** builder, so envelope and bundle
assembly are genuinely exercised. The discriminating proof it ran: the
stub signer receives the DSSE pre-authentication encoding, not the raw
payload. `SigstoreSigner`'s own test double dies loudly unstubbed,
because a fabricated bundle would be a signature-shaped lie. CycloneDX
conformance is pinned against the published JSON schema, vendored as a
test fixture at `packages/sbom/__test__/fixtures/bom-1.6.SNAPSHOT.schema.json`,
so declining the object-model library costs no conformance confidence.
The NTIA suite's discriminating direction is the negative case: a
validator that returns satisfied unconditionally passes every positive
test. An opt-in end-to-end run against Sigstore *staging* exists to catch
upstream protocol drift and never runs in default CI. No secrets appear in
spans: the identity token is carried as `Redacted` end to end and
declassified exactly once, inside the live signer.

## Deliberately not here

- A CycloneDX object-model dependency, and the lazy-import cache that
  existed to defer its optional peers — see
  [sbom owns its emitter](../decisions/sbom-owns-its-emitter.md).
- In-flight sibling merge semantics: a package depending on a sibling
  released in the same wave and therefore absent from the registry is a
  release-planning decision, not an SBOM one — the caller assembles the
  component list, and [`workspaces`](workspaces.md) already knows the
  release set.
- OIDC token issuance and JWT claim decoding — both belong beside the
  runner that issues the token, in
  [`github-actions`](github-actions.md).
- Archive production: attestation's subject is a digest of an artifact
  that already exists, so this package hashes a file and never creates
  one. The trigger for a future archive-producing package is a consumer
  needing the kit to produce the artifact whose digest it attests,
  reproducibly, so two builds agree.
- A CycloneDX dependency graph: the flat component list plus a declared
  root satisfies the NTIA element, and no consumer has asked for a
  transitive graph.
