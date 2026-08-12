---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - github.md
  - github-actions.md
  - github-actions-attestation.md
  - spdx.md
  - package-json.md
---

# @effected/sbom design

## Overview

`@effected/sbom` owns the **software-supply-chain artifact** half of attestation: producing a CycloneDX 1.6 SBOM, reporting it against the NTIA minimum elements, modelling in-toto statements and SLSA provenance, and signing a statement into a Sigstore DSSE bundle. The attestation **REST surface** is [`@effected/github`](github.md)'s, and the mint → sign → build → attest **pipeline** is consumer composition; this package owns the artifacts and the signing.

Two properties shape every decision below.

**It is two capabilities in one package, and they must stay independently reachable.** Generating and validating an SBOM is pure computation over a manifest. Signing is network-bound cryptography against Fulcio and Rekor. A consumer that only wants an SBOM must not pull the Sigstore stack into its bundle, and a consumer that only signs provenance must not pull an SBOM emitter. That is the [reachability invariant](#bundle-reachability), and it drives the module split more than anything else — it is also why the two halves stay in one doc: the invariant binding them is the design.

**The heaviest available dependency is the one this package declines.** See below.

## Tier and the dependency decision

**Integrated tier**, unavoidably: `@sigstore/sign` is a real external runtime dependency and there is no honest way around it. The design question is therefore not *whether* to be integrated but **how small the integrated surface can be** — and the answer is one module.

**Declined: a CycloneDX object-model library.** The obvious candidate is multiple megabytes with seven optional peer dependencies, of which everything used here is an object model plus a JSON normalizer; the parts that earn the weight — XML serialization, JSON-schema validation via ajv, SPDX expression parsing — are exactly the parts never called. Three pieces of evidence made declining it easy rather than close: its optional-peer maze had already cost two consumer repos hand-rolled bundler ignore lists and a lazy-import cache; CycloneDX JSON is a **published schema, not an engine**, so emitting conformant output is serialization with a field-ordering convention (the [`@effected/toml` / `@effected/glob` economics](../effect-standards.md#dependency-policy), and here not even an algorithm port); and its SPDX peer is exactly what [`@effected/spdx`](spdx.md) exists to replace, so taking it would install a second SPDX engine beside our own. **Recorded reversal trigger:** needing CycloneDX **XML** output, or needing to *consume and validate* third-party BOMs rather than emit our own.

**Taken: `@sigstore/sign` and `@sigstore/bundle`.** Real dependencies, no optional-peer maze, and decisively **cryptography plus a wire protocol** against Fulcio and Rekor. Re-implementing X.509 issuance and transparency-log inclusion proofs is what the [never re-implement platform specifics](../effect-standards.md#the-consolidated-core-and-the-require-in-r-default) rule protects against, and getting it subtly wrong is a security defect rather than a bug. Take it, confine it to one module, and let the reachability test prove the confinement.

**Kit edges:** [`@effected/spdx`](spdx.md) for license expressions on components — never a second SPDX engine — and [`@effected/package-json`](package-json.md) for manifest-derived metadata. `Package` is imported as a **type only**, so package-json's IO module never joins this package's runtime graph, and `Package`, `Person` and `Repository` are **re-exported from this package's entry point** because the metadata surface speaks them: a caller must be able to name its parameter type without declaring an edge on a package it only touches through ours.

**No `@effected/github` edge, in either direction** — see [the attestation seam](#the-attestation-seam-no-edge-either-way).

## Module map

Module-per-concept; `src/index.ts` re-exports only. See `src/`:

| Module | Owns | Reaches |
| --- | --- | --- |
| `SbomDocument.ts` | the CycloneDX 1.6 model and its normalizing serializer | spdx |
| `Sbom.ts` | the emitter facade: assemble, serialize, write | spdx, package-json |
| `SbomMetadataSource.ts` | derivation from a `Package` manifest plus explicit overrides, and the purl encoder | package-json |
| `NtiaReport.ts` | the seven-element report | — |
| `InTotoStatement.ts` | statements, subjects, digests, predicate types | — |
| `SlsaProvenance.ts` | the typed SLSA Provenance v1 predicate and its GitHub-workflow constructor | — |
| `SigstoreBundle.ts` | the DSSE bundle value and its media types | — |
| `SigstoreSigner.ts` | **the only module importing `@sigstore/*`**: the signer service, its layers, `SigningError` | `@sigstore/*` |
| `IdentityToken.ts` | the inverted OIDC contract and its static/test layers | — |

There is deliberately **no `src/internal/`**: the JSON normalizer sits in the module whose serializer it is, git-URL normalization belongs to `@effected/package-json`, and purl encoding is **public**, because a caller assembling its own components or naming an in-toto subject needs the same encoder.

## Assembly is total; only IO can fail

Assembling a document and serializing it are **plain functions with no error channel**. A predecessor typed them as effects failing on "build" and "serialize", which could only fire because the CycloneDX library might throw — a failure mode introduced *by* the dependency. With an owned model whose inputs are already-validated schema values, neither can fail. Only writing keeps an error channel, and it is IO's. That is the [formatter convention](../formatter-convention.md) applied honestly to a non-format package: a pure boundary exposes the sync primitive, and an `Effect` wrapper is offered only where the error channel is real.

The same audit found two more can't-fire channels in the source it replaced — a provenance constructor wrapped in `Effect.try` over pure string interpolation, and an NTIA check testing a field the model declares required. **A channel that cannot fire is worse than no channel**: it forces every caller to handle a case that does not exist and makes the type a lie.

**A license is an expression field, and the emitter picks between three shapes.** CycloneDX constrains a license `id` to the SPDX identifier enumeration, but a `package.json` `license` is an *expression* field — so `MIT OR Apache-2.0`, an ordinary value and exactly what manifest derivation feeds it, produced a document that looked right and failed validation. A catalog identifier emits an `id`, a valid expression emits the schema's one-element `expression` tuple, and anything else (`UNLICENSED`, `SEE LICENSE IN …`) emits a named license. The branches are exclusive because the expression tuple caps at one element, so an expression among several entries degrades to a named license rather than producing an invalid document. This is where the [spdx edge](#tier-and-the-dependency-decision) becomes real.

**The purl encoder follows the spec, not intuition.** `encodeURIComponent(name)` collapses a scope's separating slash; the package-url spec's own npm vector is `pkg:npm/%40angular/animation@12.3.1` — **the scope is the purl namespace**, its `@` percent-encoded and the slash literal — and its type definition says so outright. Versions pass through verbatim, because every character semver permits is a legal RFC 3986 path character. Both are pinned to the published vectors rather than reasoned about.

## What a manifest cannot say

`SbomMetadataSource` derives what a manifest actually contains and refuses to fabricate the rest. **Supplier, BOM authors and the timestamp are explicit-only**: a manifest says who wrote the software, never which organization supplied it, who assembled the BOM or when — and deriving any of them would fabricate three of the seven NTIA elements. Publisher resolution (explicit → supplier → author) *is* derived, which is what keeps that element satisfiable from a manifest alone.

Three more postures come from the same discipline. The copyright formatter **takes the year as an argument**, because defaulting it to the current year makes the output untestable and the purity a claim rather than a property. An unrecognized `repository` emits **no VCS reference at all**, since an external reference's URL field is a URL and passing `owner/name` through would validate and mislead. And `merge` is field-wise with **no precedence opinion**: which side is the override is release policy, and the config file that expresses it is the consumer's.

Most of the mapping's *inputs* turned out to belong to [`@effected/package-json`](package-json.md) — author parsing, repository-URL normalization, `bugs`, `homepage`, `maintainers` and `keywords` — and all of them live there now, which is why this package hand-rolls none of them.

## The NTIA report is a report, not a gate

The minimum elements are a published standard with seven named elements, modelled as a **pure total function returning a report**. Compliance is a question, not an error: a caller may legitimately emit a non-compliant SBOM and warn, so `compliant` is a derived getter and a caller wanting a hard gate fails at its own boundary.

Each element carries a **stable literal id**, not a display string — a predecessor carried prose like `"Supplier Name"` and consumers matched on it, when rendering is presentation and belongs at the edge. There are **no suggestion strings**, because the predecessor's named one consumer's own config file, which is precisely the coupling this package exists to remove; consumers map the missing set to their own remediation text.

The dependency-relationship element asks for a **declared subject** — a root component, with the component count as its value — rather than for the mere presence of a component list. A list of components with nothing saying what they are components *of* relates nothing to anything. An empty list still passes, because "this package has no dependencies" is an assertion rather than a gap, and the timestamp element additionally requires the value to **parse**, since a field holding `last tuesday` records nothing.

## SLSA provenance

The predicate is a **typed schema class, not a `Record<string, unknown>`**, and its GitHub-workflow constructor is **total**. A verifier consuming a malformed predicate fails far from the mistake, which is what typing the shape at the boundary that builds it prevents.

Three placement decisions carry it. There is **no ambient environment read**: the server URL is a required field on the constructor's input, so the constructor is a pure projection and the ambient read moves to the caller. The **build-type identifier stays here**, because it names a provenance shape rather than an Actions runtime detail. And the constructor's input is a **plain record, not a contract service** — there is nothing to swap and no IO to invert, and inventing a seam for it would be the mistake [this kit already records](commands.md#the-one-rule).

The emitted shape is **byte-compatible with what the upstream Actions attestation toolkit produces**, deliberately, so downstream verifiers see the same structure regardless of which path produced the attestation. That is a **pinned fixture test with a deep-equal**, so an extra field fails as loudly as a missing one — and the fixture's claims deliberately give the workflow ref and the job workflow ref **different** values, because with them equal a constructor that confuses the two passes every assertion. One divergence from upstream is in our favour: upstream reads its server URL with no default and writes the literal string `undefined` into every URL it builds when the variable is unset.

## Signing and the identity seam

`SigstoreSigner.sign(statement)` is the whole surface. Two things about its shape are decisions:

**The audience string stays in this package.** It is Sigstore's requirement, not the caller's knowledge, which is why `sign` takes only a statement and asks the contract for a token rather than taking a token parameter. Considered and rejected: `sign(statement, { token })`, which reads simpler and forces every caller to know a constant belonging to the signing protocol.

**`IdentityToken` is an inverted contract.** OIDC token issuance belongs to the Actions runtime, and this package must not depend on [`@effected/github-actions`](github-actions.md) — that package is integrated with a required `@effect/platform-node` peer, and taking the edge would drag a platform peer into every SBOM consumer. So this package declares the narrow contract, ships `layerStatic` for a consumer that already holds a token, and github-actions ships the implementing layer: [`ActionsIdentityToken`](github-actions-attestation.md). The module header names that implementation, because a contract that does not point at its implementation reads as unimplemented — and until it existed, every action wanting a signed attestation wrote the adapter itself, which is the work an inverted contract is supposed to have already done.

`SigningError`'s `kind` is chosen by reading the signing library's own internal error codes rather than guessed, and an unattributable failure is honestly "the bundle did not get built" rather than assigned to a step. A predecessor's recursive cause-chain-to-string flattener **has no successor**: it existed because the error was about to become a message, and a structural `cause` makes the whole walk unnecessary.

Two facts that only surfaced by running it, both pinned: the bundle's **media type is carried through from the builder** rather than declared as a literal, because the builder picks a version depending on whether a certificate chain is present and a literal would quietly lie; and an unwitnessed bundle has **no transparency-log key at all**, since protobuf JSON omits empty repeated fields.

## The attestation seam: no edge, either way

This package produces a signed bundle; [`@effected/github`](github.md)'s attestation surface accepts one. If `github` typed that parameter as *this package's class*, github would depend on sbom; if this package performed the upload, sbom would depend on github. Both are avoidable, because the bundle crossing the seam is a **serialized JSON value with a stable published shape**: `github` types the parameter structurally, this package's bundle satisfies it, and the consumer wires them together.

That is the same call `github` makes for its subject digest versus lockfiles' integrity hash — a small deliberate duplication in preference to dragging a package across a seam.

## Bundle reachability

The invariant: **an SBOM-only consumer must not reach `@sigstore/*`, and a signing-only consumer must not reach the SBOM emitter.** Three mechanisms, in order of how load-bearing they are:

1. **One module imports `@sigstore/*`.** Nothing in the document, emitter, report, metadata or provenance modules names those packages, transitively or otherwise. Statements, predicates and bundles are their own modules precisely so a consumer can build and inspect one without loading the signer — which is also what lets a *verifier* depend on the shapes alone.
2. **Free-standing named exports, never a namespace object.** The [config-file rule](config-file.md) applies verbatim and with unusual force: a convenience object gathering generation and signing would make every SBOM consumer reachable to Fulcio's HTTP stack, silently. This is the single easiest way to destroy the property and must not be introduced in any form.
3. **A reachability test with a control.** The test walks the **runtime import graph of `src`** statically from the SBOM surface and asserts no `@sigstore/*` edge appears — *and* proves it can fail by asserting the signer module does reach them. A one-sided assertion is the classic test that cannot fail.

**Be precise about which graph that constrains.** It constrains the **import** graph, not the **resolver** graph: `@sigstore/*` is a declared runtime dependency of this package, so it is installed wherever this package is, and a bundler's resolver walks it regardless. Whether an unreferenced module is then dropped is the bundler's decision, resting on `"sideEffects": false` (which the suite asserts) plus the module-per-file output the builder emits.

That distinction has a live consequence rather than a theoretical one: [`@effected/github-actions`](github-actions.md) depends on this package for [two small seam adapters](github-actions-attestation.md), so **every consumer of that package installs this one's dependencies even if it never signs anything**. The claim this design supports is "a consumer that does not import the signer links nothing from it, and a tree-shaking bundler can drop it"; the claim it does **not** support is "the dependency is absent from the consumer's tree by construction". A predecessor's bundler ignore list is deleted by *this* package's confinement only for consumers that bundle and tree-shake — not by the split alone.

**The walker's comment-stripping order is load-bearing, and the obvious order is wrong.** Stripping block comments before line comments lets a `/*`-containing token in prose open a block comment and delete everything to the end of the next doc comment, imports included — a module importing `effect` was reported as importing nothing. An under-reporting walker makes a confinement test pass for the wrong reason. Line comments come out first here; sibling packages that copied an earlier walker have the opposite order and are safe only while no prose in them contains `/*`.

## Testing

The design has to answer "how do you test signing without real keys or OIDC", and the signing library is built for it.

- **The DSSE bundle builder takes a signer and a witness by interface**, so a test supplies a stub signer returning a fixed key and certificate and a stub witness returning a canned log entry. No network, no keys, no OIDC — and **the code under test is the real builder**, so envelope and bundle assembly are genuinely exercised rather than mocked away. The discriminating proof that it ran: the stub signer receives the DSSE **pre-authentication encoding**, not the payload.
- **The identity contract makes the OIDC half trivial** — a test layer answers a fixed redacted token. That is the payoff of inverting the contract rather than importing an issuer.
- **`SigstoreSigner`'s own double dies loudly unstubbed.** A fabricated bundle would be a signature-shaped lie, which is the strongest possible case for the die-loudly default.
- **CycloneDX conformance is pinned against the published JSON schema**, vendored as a test fixture. The schema is the oracle, so declining the library costs no conformance confidence, and this is where an emitted-field regression surfaces.
- **The NTIA suite's discriminating direction is the negative case**: a validator returning satisfied unconditionally passes every positive test.
- **An opt-in e2e against Sigstore *staging*** exists to catch upstream protocol drift, gated behind an env var and never run in CI by default.
- **No secrets in spans.** `Effect.fn` names on the public fallible boundaries only, the token carried as `Redacted` end to end and declassified exactly once, inside the live signer.

Build through `pnpm build --filter @effected/sbom`. Two public input interfaces spell their shared members out twice rather than extend a private base: an internal type named on a public signature is a forgotten export, and a named alias is still a named symbol.

## Deliberately not here

- **A CycloneDX object-model dependency** and the lazy-import cache that existed to defer its optional peers.
- **In-flight sibling merge semantics.** A package depending on a sibling released in the same wave and therefore absent from the registry is a **release-planning** decision, not an SBOM one; the caller assembles the component list, and `@effected/workspaces` already knows the release set.
- **OIDC token issuance and JWT claim decoding** — both belong beside the runner that issues the token, in `@effected/github-actions`. The decoder's one genuine subtlety travels with it: it deliberately does **not** verify the signature, because the token came from the runner's own token-service endpoint over TLS and the claims populate a predicate rather than a trust decision.
- **Archive production.** Attestation's subject is a **digest of an artifact that already exists**, so this package hashes a file and never creates one — no tar, no entry ordering, no mtime normalization anywhere in the surface. The trigger for an `@effected/archive` package is a consumer needing the kit to *produce* the artifact whose digest it attests, reproducibly, so two builds agree.
- **A CycloneDX dependency graph.** The flat component list plus a declared root satisfies the NTIA element, no consumer has asked for a transitive graph, and adding one later is additive: an array plus a stronger check, with no change to what the element means.
