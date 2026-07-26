---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - github.md
  - spdx.md
  - package-json.md
  - commands.md
---

# @effected/sbom design

## Overview

`@effected/sbom` owns the **software-supply-chain artifact** half of the old `Attest` knot: producing a CycloneDX SBOM, validating it against the NTIA minimum elements, and signing an in-toto statement into a Sigstore DSSE bundle. It is **Phase 4** of the GitHub/Actions split program (`2026-07-25-github-split-master.md`), and it is the phase where program decision 5's three-way split lands its middle piece: the attestation **REST surface** is [`@effected/github`](github.md)'s `Attestation`, the **pipeline** that mints-signs-builds-attests is consumer composition, and **signing plus SBOM** are here.

Two properties shape every decision below.

**It is two independent capabilities in one package, and they must stay independently reachable.** Generating and validating an SBOM is pure computation over a manifest. Signing is network-bound cryptography against Fulcio and Rekor. A consumer that only wants an SBOM must not pull the Sigstore stack into its bundle, and a consumer that only signs provenance must not pull an SBOM emitter. That is the [bundle-reachability story](#bundle-reachability) and it drives the module split more than anything else.

**The heaviest dependency in the program is the one we decline.** `@cyclonedx/cyclonedx-library` is 6.6 MB with seven optional peer dependencies; we use about ten symbols of it, none of them the parts that justify the weight. See [the dependency decision](#tier-and-the-dependency-decision).

## Tier and the dependency decision

**Integrated tier**, unavoidably: `@sigstore/sign` is a real external runtime dependency and there is no honest way around it. The design question the program set is therefore not *whether* to be integrated but **how small the integrated surface can be**, and the answer is: one module, ~380 KB, with the 6.6 MB half declined outright.

### Declined: `@cyclonedx/cyclonedx-library` (6.6 MB)

Measured against the installed copy in `savvy-web/systems` (10.1.0, Apache-2.0):

| Fact | Value |
| --- | --- |
| Unpacked size | **6.6 MB** |
| Runtime `dependencies` | none |
| Peer dependencies | `ajv`, `ajv-formats`, `ajv-formats-draft2019`, `libxmljs2`, `xmlbuilder2`, `packageurl-js`, `spdx-expression-parse` |
| …of which optional | **all seven** |

Everything the v3 `SbomLive` uses is in this list: `Models.Bom`, `Models.Component`, `Models.Metadata`, `Models.NamedLicense`, `Models.OrganizationalEntity`, `Models.OrganizationalContact`, `Enums.ComponentType`, `Serialize.JSON.Normalize.Factory`, `Serialize.JsonSerializer`, `Spec.Spec1dot5`. That is an **object model plus a JSON normalizer**. The parts that earn 6.6 MB — XML serialization, JSON-schema validation via ajv, SPDX expression parsing — are exactly the parts we never call.

Three pieces of evidence make declining it the easy call rather than a close one:

1. **The optional-peer maze is already a known tax.** silk-sync-action carries an eleven-line bundler ignore for this library's transitive xml/ajv imports, and `SbomLive` carries a hand-rolled lazy-import cache with a comment explaining that rspack emits top-level `import * as` statements which fail at Node's resolution phase when the optional peers are absent. Two workarounds in two repos, for a library whose output we can emit directly.
2. **CycloneDX JSON is a published schema, not an engine.** Emitting conformant 1.6 JSON is serialization with a field-ordering convention. This is the [`@effected/toml` / `@effected/glob` economics](../effect-standards.md#dependency-policy) — own the small thing rather than take the encumbered large one — with the difference that here we are not even porting an algorithm, only writing a normalizer.
3. **Its SPDX peer is a rule violation in waiting.** `spdx-expression-parse` is exactly what [`@effected/spdx`](spdx.md) exists to replace, and the decisions log rules that license handling delegates there and is never re-implemented. Taking the library would install a second SPDX engine beside our own.

**Decision: own the emitter.** `SbomDocument` is a `Schema.Class` tree mirroring the CycloneDX 1.6 JSON shape; serialization is a normalizer with stable key ordering. Conformance is pinned against the **published CycloneDX JSON schema as a test fixture** (see [testing](#testing-strategy)) — the schema is the oracle, so we get validation at test time without shipping ajv.

**Recorded reversal trigger:** if we ever need CycloneDX **XML** output, or need to *consume and validate* third-party BOMs rather than emit our own, re-open this. Both are outside every consumer's need today.

### Taken: `@sigstore/sign` + `@sigstore/bundle` (~380 KB)

| Package | Size | License | Runtime deps |
| --- | --- | --- | --- |
| `@sigstore/sign` | 296 KB | Apache-2.0 | `@sigstore/bundle`, `@sigstore/core`, `@sigstore/protobuf-specs`, `make-fetch-happen`, `@gar/promise-retry`, `proc-log` |
| `@sigstore/bundle` | 84 KB | Apache-2.0 | `@sigstore/protobuf-specs` |

Real dependencies, no optional-peer maze, and — decisively — **this is cryptography and a wire protocol against Fulcio and Rekor**. Re-implementing X.509 certificate issuance and transparency-log inclusion proofs is precisely what the [never re-implement platform specifics](../effect-standards.md#the-consolidated-core-and-the-require-in-r-default) rule protects against, and getting it subtly wrong is a security defect rather than a bug. Take it, confine it to `SigstoreSigner.ts`, and let the [reachability test](#bundle-reachability) prove the confinement.

### Kit edges

| Edge | Why |
| --- | --- |
| `@effected/spdx` (`workspace:~`) | license expressions on components — the decisions-log delegation, never a second SPDX engine |
| `@effected/package-json` (`workspace:~`) | manifest-derived metadata; see [the split](#the-metadata-derivation-split) |
| `effect` (peer) | core |

**No `@effected/github` edge, in either direction** — see [the attestation seam](#the-attestation-seam-no-edge-either-way).

## Module map and surface

Module-per-concept; `src/index.ts` re-exports only.

| File | Owns | Reaches |
| --- | --- | --- |
| `src/SbomDocument.ts` | the CycloneDX 1.6 model (`SbomDocument`, `Component`, `SbomMetadata`, `Supplier`, `Contact`, `ExternalReference`, `Purl`) and `toJson` | spdx |
| `src/Sbom.ts` | the emitter facade: `Sbom.generate` (pure), `Sbom.toJson`, `Sbom.write` | spdx, package-json |
| `src/SbomMetadataSource.ts` | derivation from a `Package` manifest + explicit overrides, and the override-layering rule | package-json |
| `src/NtiaReport.ts` | the seven-element validator: `NtiaReport`, `NtiaElement`, `NtiaReport.of(document)` | — |
| `src/InTotoStatement.ts` | `InTotoStatement`, `InTotoSubject`, `Sha256Digest`, `PredicateType`, statement constructors | — |
| `src/SlsaProvenance.ts` | the typed SLSA Provenance v1 predicate and its GitHub-workflow constructor | — |
| `src/SigstoreBundle.ts` | the DSSE bundle value (`SigstoreBundle`, media-type constants) | — |
| `src/SigstoreSigner.ts` | **the only module importing `@sigstore/*`**: `SigstoreSigner` service, layers, `SigningError` | `@sigstore/sign`, `@sigstore/bundle` |
| `src/IdentityToken.ts` | the inverted OIDC contract (`IdentityToken`, `IdentityTokenError`, `layerStatic`, `layerTest`) | — |
| `src/internal/` | the JSON normalizer, purl encoding, git-URL normalization helpers | — |

### Sbom — and the error channel that should not exist

```ts
export interface SbomInput {
  readonly root: Component;
  readonly components: ReadonlyArray<Component>;
  readonly metadata?: SbomMetadata;
}

export declare const Sbom: {
  /** Assemble a document. TOTAL — no error channel. */
  readonly generate: (input: SbomInput) => SbomDocument;
  /** Canonical CycloneDX 1.6 JSON. TOTAL. */
  readonly toJson: (document: SbomDocument, options?: { readonly space?: number }) => string;
  /** Write the JSON to a path. Fails only on IO. */
  readonly write: (
    document: SbomDocument,
    path: string,
  ) => Effect.Effect<void, SbomWriteError, FileSystem.FileSystem>;
};
```

**`generate` and `toJson` are total, and that is a deliberate correction.** v3 typed all three members `Effect<_, SbomError>` with `reason: "build" | "serialize" | "save"`, but "build" and "serialize" could only fail if the CycloneDX library threw — a possibility introduced *by* the dependency. With an owned model whose inputs are already-validated `Schema.Class` values, assembling and stringifying cannot fail, so they are plain functions. Only `write` keeps an error channel, and it is IO's.

That is the [formatter convention](../formatter-convention.md) applied honestly to a non-format package: a pure boundary exposes a sync primitive, and an `Effect` wrapper is offered only where the error channel is real.

In-flight sibling packages — the case v3's `inFlightPackages` existed for, where a package depends on a sibling being released in the same wave and therefore absent from the registry — are handled by the caller assembling `components`. The kit does not need a second merge rule for it: `@effected/workspaces` already knows the release set, and `resolveDependencies`' "in-flight wins over registry" is a **release-planning** decision, not an SBOM one. Recorded as [deliberately not ported](#deliberately-not-ported).

### NtiaReport — the validator

The NTIA minimum elements are a published standard with seven named elements, which is why the spec calls the v3 validator "portable as-is". It ports as a **pure total function returning a report**, never as a pass/fail assertion:

```ts
export class NtiaElement extends Schema.Class<NtiaElement>("NtiaElement")({
  /** The element's stable identifier — a literal, not free text. */
  id: NtiaElementId,           // "supplierName" | "componentName" | "componentVersion"
                               // | "uniqueIdentifier" | "dependencyRelationship"
                               // | "sbomAuthor" | "timestamp"
  satisfied: Schema.Boolean,
  /** The value that satisfied it, when one did. */
  value: Schema.optionalKey(Schema.String),
}) {}

export class NtiaReport extends Schema.Class<NtiaReport>("NtiaReport")({
  elements: Schema.Array(NtiaElement),
}) {
  get compliant(): boolean;
  get missing(): ReadonlyArray<NtiaElementId>;
  static of(document: SbomDocument): NtiaReport;
}
```

Three deltas from the v3 shape, each with a reason:

- **`id` is a literal union, not a display string.** v3 carried `name: "Supplier Name"` and consumers matched on prose. A stable id is what a consumer branches on; rendering "Supplier Name" is presentation and belongs at the edge.
- **No `suggestion` field.** v3's suggestions name silk-release-action's own config file (`Add supplier.name to .github/silk-release.json`) — a library cannot know the consumer's config format, and embedding one repo's file name in a kit package is exactly the coupling this program exists to remove. Consumers map `missing` to their own remediation text.
- **A report, not a failure.** Compliance is a question, not an error: a caller may legitimately emit a non-compliant SBOM and warn. `compliant` is a derived getter, so a caller that wants a hard gate writes `if (!report.compliant) yield* Effect.fail(...)` at its own boundary.

### SlsaProvenance — the predicate, typed

`buildSLSAProvenancePredicate` was unclaimed by any phase until the consumer survey routed it here (2026-07-25). **It lands in this package**, as a `Schema.Class` rather than the `Record<string, unknown>` it is today.

The home question is "what *is* this value" versus "where do its inputs come from", and the two answers point at different packages. The value is a **SLSA provenance predicate** — the payload of an in-toto statement, and `InTotoStatement` is here. Its inputs are **GitHub Actions OIDC claims and runner environment**, which are `@effected/github-actions`' vocabulary. Splitting on that line:

| Piece | Home | Why |
| --- | --- | --- |
| the predicate model + its constructor | **`@effected/sbom`** | a statement payload; typed, total, no ambient reads |
| `decodeJwtClaims` — decode an Actions OIDC JWT | **`@effected/github-actions`** | it decodes a runner-issued token, beside the issuer that produced it |

```ts
export class SlsaProvenance extends Schema.Class<SlsaProvenance>("SlsaProvenance")({
  buildDefinition: BuildDefinition,
  runDetails: RunDetails,
}) {
  static readonly predicateType: PredicateType;   // "https://slsa.dev/provenance/v1"
  /** SLSA provenance for a GitHub Actions `workflow/v1` build. TOTAL. */
  static forGitHubWorkflow(input: GitHubWorkflowProvenance): SlsaProvenance;
}
```

Four decisions, each correcting something measured in the source:

- **Typed, not `Record<string, unknown>`.** The predicate is untyped end to end today — v3 returns a bare record and the consumer's `buildProvenancePredicate()` returns `Record<string, unknown> | null`. A verifier consuming a malformed predicate fails far from the mistake. A `Schema.Class` makes the shape checkable at the boundary that builds it.
- **Total, with no error channel.** v3 wraps the body in `Effect.try` and declares `SlsaError { reason: "env" }`, but nothing in it can throw: it is string interpolation and object construction over already-present claims. **This is the second can't-fire error channel found in this source package**, after `Sbom.generate`/`serializeJson` — enough to call it a pattern rather than an oversight, and worth naming in the port notes.
- **No ambient `process.env`.** v3 defaults `env = process.env` and reads `GITHUB_SERVER_URL` from it. `GitHubWorkflowProvenance` carries `serverUrl` as a field, so the constructor is a pure projection and the ambient read moves to the caller — the [house cwd convention](workspaces.md#ambient-cwd-is-an-explicit-option) applied to environment.
- **`GITHUB_BUILD_TYPE` stays here.** `https://actions.github.io/buildtypes/workflow/v1` is a published **SLSA build-type identifier**, not an Actions runtime detail — it names a provenance shape, so it belongs with the provenance model.

`GitHubWorkflowProvenance` is a plain input record (`serverUrl`, `repository`, `ref`, `sha`, `eventName`, `workflowRef`, `jobWorkflowRef`, `repositoryId`, `repositoryOwnerId`, `runnerEnvironment`, `runId`, `runAttempt`) — **not a contract service**. There is nothing to swap and no IO to invert; it is the argument to a data constructor, and inventing a seam for it would be the mistake [REVERSAL 2](commands.md) records.

The shape stays byte-compatible with what `@actions/attest`'s `attestProvenance` emits, deliberately: downstream verifiers must see the same `buildDefinition` / `runDetails` structure regardless of which path produced the attestation. That compatibility is a **pinned fixture test**, not a comment.

### SigstoreSigner and the identity seam

```ts
export interface SigstoreSignerShape {
  readonly sign: (statement: InTotoStatement) => Effect.Effect<SigstoreBundle, SigningError>;
}
```

`IdentityToken` is the **third inverted contract in this program**, after `@effected/npm`'s `CatalogResolver` and `@effected/commands`' `LocalExec`:

```ts
export interface IdentityTokenShape {
  readonly token: (audience: string) => Effect.Effect<Redacted.Redacted<string>, IdentityTokenError>;
}
```

OIDC token issuance stays in `@effected/github-actions` (Phase 3), which owns `ACTIONS_ID_TOKEN_REQUEST_URL` and the Actions runtime. This package must not depend on it — github-actions is integrated with a required `@effect/platform-node` peer, and taking that edge would drag a platform peer into every SBOM consumer. So `sbom` declares the narrow contract, github-actions ships the layer implementing it, and `sbom` ships `IdentityToken.layerStatic(token)` for a consumer holding one already.

**The audience string stays in this package.** `SIGSTORE_OIDC_AUDIENCE = "sigstore"` is Sigstore's requirement, not the caller's knowledge — which is why `sign` takes only a statement and asks the contract for a token, rather than taking a token parameter. Considered and rejected: `sign(statement, { token })`, which reads simpler but forces every caller to know an audience constant that belongs to the signing protocol.

`SigningError` is sized to what a caller can act on: `kind: "identity" | "certificate" | "transparencyLog" | "bundle"`, with `cause: Schema.Defect()` carrying the original structurally. v3's `describeSigstoreError` — a 30-line recursive cause-chain flattener that scraped HTTP status codes and stack frames into a string — **has no successor**: it existed because the error was about to become a message, and a structural `cause` makes the whole walk unnecessary. That is one of the clearest "the port deletes code" wins in the program.

## The metadata-derivation split

silk-release-action's `infer-sbom-metadata.ts` (282 lines) is three different jobs wearing one file. The split is decided by asking *whose vocabulary is this*, and the answer moves most of it out of the SBOM package entirely.

| Hand-rolled today | Home | Status |
| --- | --- | --- |
| `parseAuthor` — `"Name <email> (url)"` and the object form | **`@effected/package-json`** | **Already exists**: `Person.FromValue` does exactly this, plus wire-form fidelity the hand-roll lacks. Delete, do not port. |
| `parseRepository` — git URL normalization (`git+`, `git://`, `git@host:`, `.git`) | **`@effected/package-json`** | **A gap to fill there.** `Package.repository` is typed `Schema.Union([String, Record])` — untyped and unnormalized. Every consumer wanting a repo URL needs this same normalization; it is a package.json field model, not an SBOM concept. |
| `parseBugs`, `homepage` | **`@effected/package-json`** | **Missing fields.** Neither appears in the `Package` schema at all. |
| `maintainers`, `keywords` | **`@effected/package-json`** | **Missing fields**, found when the field list was derived from this mapping rather than from the hand-roll. They serve `metadata.supplier.contact` / `component.authors` and `component.tags`. |
| Mapping those onto `externalReferences` (`vcs` / `issue-tracker` / `documentation` / `website`) | **here** | CycloneDX vocabulary. Stays. |
| `formatCopyright`, supplier/publisher resolution | **here** | SBOM metadata semantics. Stays. |
| Layering explicit config over inferred values | **consumer** | The precedence rule is release policy, and the config file is the consumer's. `SbomMetadataSource` exposes derivation and a merge helper; which file wins is not ours. |

**This is a real finding for Phase 4's plan, not just a note:** most of the mapping's inputs belong to `@effected/package-json`, one already existed there, and four were genuine gaps in a shipped package (`repository` normalization, `bugs`, `homepage`, and — found only by deriving the list from this mapping — `maintainers` and `keywords`). **All are now filled** (2026-07-25); see [package-json.md](package-json.md#the-compliance-field-set-and-what-each-one-serves) for the field-to-target table. Filling them is a small, separable change that also serves consumers with no SBOM interest at all. Flagged as a dependency of this phase's implementation, and as a candidate for its own commit ahead of the sbom package.

## The attestation seam: no edge, either way

github.md's open question 1 asks whether `Attestation` should stay in `@effected/github` or move here. **Answer from this side: it stays there, and neither package takes an edge on the other.**

`sbom` produces a `SigstoreBundle`; `github`'s `Attestation.upload` accepts one. If `github` typed that parameter as *this package's class*, github would depend on sbom; if `sbom` performed the upload, sbom would depend on github. Both are avoidable, because the bundle crossing the seam is a **serialized JSON value with a stable published shape** (`{ mediaType, verificationMaterial, dsseEnvelope }`). `github` types the parameter structurally, `sbom`'s `SigstoreBundle` satisfies it, and the consumer wires them together.

That is the same call github already made for `Sha256Digest` versus lockfiles' `IntegrityHash` — a small deliberate duplication in preference to dragging a package across a seam — applied to the one value both packages touch. Recorded per the program's shared-vocabulary rule.

## The consumer-side pipeline (a worked sketch, not shipped code)

The mint → sign → build → attest composition is **consumer composition** per decision 5. Sketching it here is how the design proves the pieces compose; nothing below ships in the kit.

```ts
// silk-release-action, after publishing a tarball
const attestRelease = Effect.fn("attestRelease")(function* (tarball: string, pkg: Package) {
  const github = yield* GitHubClient;

  // 1. SBOM — pure, no Sigstore reachable on this path at all.
  const metadata = SbomMetadataSource.fromPackage(pkg, { supplier });
  const document = Sbom.generate({ root, components, metadata });
  const report = NtiaReport.of(document);
  if (!report.compliant) yield* Effect.logWarning(`SBOM missing: ${report.missing.join(", ")}`);
  yield* Sbom.write(document, sbomPath);

  // 2. Statement over the artifact digest. The predicate is typed and total;
  //    the OIDC claims it is built from come from github-actions.
  const claims = yield* ActionsOidc.claims();            // @effected/github-actions
  const predicate = SlsaProvenance.forGitHubWorkflow(claims);
  const digest = yield* sha256Of(tarball);
  const statement = InTotoStatement.forSubject(purl, digest, predicate);

  // 3. Sign — the only step that reaches @sigstore/*.
  const signer = yield* SigstoreSigner;
  const bundle = yield* signer.sign(statement);

  // 4. Upload — @effected/github, structurally typed, no edge to this package.
  return yield* github.attestation.upload({ owner, repo, bundle });
});
```

Wiring, showing that the identity contract is the only thing github-actions supplies:

```ts
const AppLayer = Layer.mergeAll(SigstoreSigner.layer, GitHubClient.layerFromConfig).pipe(
  Layer.provide(ActionsIdentityToken.layer), // @effected/github-actions implements IdentityToken
  Layer.provide(NodeServices.layer),
);
```

## Bundle reachability

The invariant: **an SBOM-only consumer must not reach `@sigstore/*`, and a signing-only consumer must not reach the SBOM emitter.** Three mechanisms, in order of how load-bearing they are:

1. **`SigstoreSigner.ts` is the sole importer of `@sigstore/*`.** Nothing in `Sbom.ts`, `SbomDocument.ts`, `NtiaReport.ts`, `SbomMetadataSource.ts` or `SlsaProvenance.ts` names those packages, transitively or otherwise. `InTotoStatement`, `SlsaProvenance` and `SigstoreBundle` are their own modules precisely so a consumer can build and inspect a statement, a predicate or a bundle without loading the signer — which is also what lets a *verifier* depend on the shapes alone.
2. **Free-standing named exports, never a namespace object.** The [config-file rule](config-file.md) applies verbatim and with unusual force here: a `Sbom = { generate, sign }` convenience object would make every SBOM consumer reachable to Fulcio's HTTP stack, silently. This is the single easiest way to destroy the property and it must not be introduced in any form.
3. **A reachability test with a control**, following the Phase 2 precedent. The test imports only the SBOM surface, walks the resolved module graph, and asserts no `@sigstore/*` module appears — *and* proves it can fail by asserting the signer entry point does reach them. A one-sided assertion here is the classic test that cannot fail.

The v3 lazy-`import()` cache in `SbomLive` is **not ported**: it existed to defer the CycloneDX optional-peer chain, and declining that dependency removes the reason for it. Static imports with honest module boundaries beat a hand-rolled module cache.

## Testing strategy

The design must answer "how do you test signing without real keys or OIDC", and the answer is that `@sigstore/sign` is built for it.

- **`DSSEBundleBuilder` takes a `Signer` and `Witness` by interface.** The Live layer supplies `FulcioSigner` + `RekorWitness`; a test supplies a **stub signer** returning a fixed key/certificate and a **stub witness** returning a canned transparency-log entry. No network, no keys, no OIDC — and the code under test is the real builder, so the DSSE envelope and bundle assembly are genuinely exercised rather than mocked away.
- **`IdentityToken` makes the OIDC half trivial**: `IdentityToken.layerTest()` answers a fixed `Redacted` token. This is the payoff of inverting the contract rather than importing an issuer.
- **`SigstoreSigner.makeTest` / `layerTest`** for consumers of the signer: `sign` **dies loudly** unstubbed — a fabricated bundle would be a signature-shaped lie, the strongest possible case for the die-loudly default, and no honest default exists. (Contrast `LocalExec.makeTest`, whose `Option.none()` *is* a real answer; the test remains "would a real implementation legitimately answer this?")
- **CycloneDX conformance** is pinned by validating emitted documents against the **published CycloneDX 1.6 JSON schema**, vendored as a test fixture with a `VENDORED.md` pin. The schema is the oracle, so declining the library costs no conformance confidence — and this is where an emitted-field regression surfaces.
- **NTIA**: a table test over the seven elements, each with a document that satisfies it and one that does not. The discriminating direction is the negative case: a validator that returns `satisfied: true` unconditionally passes every positive test.
- **An opt-in e2e against Sigstore *staging*** (`fulcioBaseURL`/`rekorBaseURL` overrides), gated behind an env var and never run in CI by default. It exists to catch upstream protocol drift, not as a gate.
- No secrets in spans: `Effect.fn` names on the public fallible boundaries only, with the token never annotated. `Redacted` carries the token end to end and is declassified exactly once, inside the Live signer.

## Deliberately not ported

- **The CycloneDX library and its lazy-import cache** — see the dependency decision.
- **`describeSigstoreError`** — a structural `cause` replaces the cause-chain-to-string walk.
- **`inFlightPackages` merge semantics** — release planning, not SBOM assembly; the caller assembles components.
- **NTIA `suggestion` strings** — they name a consumer's config file; consumers map `missing` to their own text.
- **`Sbom.save`'s error taxonomy** — `reason: "build" | "serialize"` described failures that an owned model cannot have.
- **`OidcTokenIssuer`** — stays in `@effected/github-actions`; this package declares the contract only.
- **`decodeJwtClaims`** — decodes an Actions-issued OIDC JWT; it belongs beside the issuer, in `@effected/github-actions`. Note its one genuine subtlety travels with it: it deliberately does **not** verify the signature, because the token came from the runner's own token-service endpoint over TLS and the claims populate a predicate rather than a trust decision. That reasoning must survive the move, or someone will "fix" it into a JWKS fetch.
- **`SlsaError`** — its `reason: "env"` arm described a failure the predicate constructor cannot have; the `"decode"`/`"claims"` arms travel with `decodeJwtClaims` to github-actions.

## Archive: evaluated, not triggered

The decisions log rules that `@effected/archive` is built at **first need**, expected in this phase because attestation wants byte-reproducible artifacts. **Assessed: this phase does not trigger it.** Attestation's subject is a **digest of an artifact that already exists** — the tarball `npm pack` produced — so this package hashes a file and never creates one. No tar, no entry ordering, no mtime/uid normalization anywhere in the surface above.

The trigger is recorded rather than discharged: if a consumer needs the kit to **produce** the artifact whose digest it attests — reproducibly, so two builds agree — that is the moment `@effected/archive` gets designed. Phase 5's `PackagePublish` is the likeliest place, since `npm pack` determinism is the same question one layer down.

## As built (2026-07-25)

The package shipped in three milestones against this design. Everything above held; what follows is what the implementation added, corrected or decided, and it is the authoritative record where the two disagree.

### Module map, as built

Nine source modules, one per concept, `src/index.ts` re-exporting only — as designed, with one omission.

**`src/internal/` does not exist.** The design gave it three jobs and all three evaporated: the JSON normalizer sits inline in `SbomDocument.ts` (it is that module's own serializer), git-URL normalization moved to `@effected/package-json`'s `Repository.browseUrl`, and purl encoding is `SbomMetadataSource.npmPurl` — **public**, because a caller assembling its own components, or naming an in-toto subject, needs the same encoder. A one-function private directory was ceremony.

### The purl was wrong in the source, and the spec settled it

`encodeURIComponent(name)` — the predecessor's encoder — collapses a scope's separating slash to `%2F`. The package-url specification's own npm roundtrip vector is `pkg:npm/%40angular/animation@12.3.1`: **the scope is the purl namespace**, its `@` percent-encoded, the slash literal. Its type definition says so outright ("the npm scope @ sign prefix is always percent encoded"). Fetched from `package-url/purl-spec` (`tests/types/npm-test.json`, `types/npm-definition.json`) rather than reasoned about, and pinned to that vector.

Versions pass through verbatim: every character semver permits is a legal RFC 3986 path character (`+` is a sub-delim), so encoding them would produce a longer string meaning the same thing and matching no published example.

### A license is an expression field — three shapes, and the spdx edge is what picks

**A defect found in the emitter and fixed.** `component.licenses` rendered every entry as `{ license: { id } }`, but CycloneDX constrains `license.id` to the SPDX identifier enumeration. A `package.json` `license` is an *expression* field, so `MIT OR Apache-2.0` — an ordinary value, and exactly what manifest derivation feeds it — produced a document that looked right and failed validation. The schema offers three shapes and the emitter now picks between them:

| Input | Emitted | Chosen by |
| --- | --- | --- |
| a catalog identifier (`MIT`) | `[{ license: { id } }]` | `License.isKnownId` |
| an expression (`MIT OR Apache-2.0`) | `[{ expression }]` — the schema's one-element tuple | `isValidExpression` |
| anything else (`UNLICENSED`, `SEE LICENSE IN …`) | `[{ license: { name } }]` | neither |

The branches are exclusive (`maxItems: 1` on the expression tuple), so an expression among several entries degrades to a named license rather than producing an invalid document. This is where the [`@effected/spdx` edge](#kit-edges) becomes real: before it, the dependency was declared and unused.

### `SbomMetadataSource`, and what a manifest cannot say

Seven members: `npmPurl`, `componentFor`, `rootComponent`, `externalReferences`, `fromPackage`, `formatCopyright`, `merge`. All total, all pure.

- **`supplier`, `authors` and `timestamp` are explicit-only.** A manifest says who wrote the software; it never says which organization supplied it, who assembled the BOM, or when. Deriving any of them would fabricate three of the seven NTIA elements. Publisher resolution (`explicit → supplier → author`) *is* ported, which is what keeps element 6 satisfiable from a manifest alone.
- **`formatCopyright` takes the year as an argument.** The predecessor defaulted it to `new Date().getFullYear()`, which made its output untestable and its purity a claim rather than a property. The [no-ambient-environment rule](#slsaprovenance--the-predicate-typed) applied to time.
- **An unrecognized `repository` emits no `vcs` reference.** `externalReference.url` is a URL; passing `owner/name` through would validate and mislead. Normalization is `Repository.browseUrl`'s — including the `git+ssh://` form the predecessor's regex chain left with its scheme intact.
- **`merge` is field-wise with no precedence opinion.** Which side is the override is the consumer's release policy, as designed.
- **`Package` is imported as a TYPE only**, so `@effected/package-json`'s IO module never joins this package's runtime graph. The reachability suite asserts the resulting edge set exactly.

### NTIA element 5 could not be ported as written

v3's dependency-relationship check was `sbom.components !== undefined` — against a field this model declares **required**, so it is a check that cannot fail. That is the third can't-fire construct found in the source package, after `generate`/`serialize` and `SlsaError`.

As built, the element asks for a **declared subject**: `metadata.component` present, with the component count as its value. A list of components with nothing saying what they are components *of* relates nothing to anything, which is what the element is about; an empty list still passes, because "this package has no dependencies" is an assertion rather than a gap. Element 7 additionally requires the timestamp to **parse** — a field holding `last tuesday` records nothing.

### SLSA provenance: two classes, one fixture

`SlsaBuildDefinition` and `SlsaRunDetails` are `Schema.Class`es; their internals are inline `Schema.Struct`s rather than ten more exported nested classes. The compatibility claim is pinned by `__test__/fixtures/actions-attest-provenance.json`, transcribed from `actions/toolkit`'s own `buildSLSAProvenancePredicate` (`@actions/attest@3.2.0`, commit `0be0a6ef`) and asserted with a **deep-equal**, so an extra field fails as loudly as a missing one.

One divergence from upstream, in our favour: it reads `process.env.GITHUB_SERVER_URL` with no default, so an unset variable writes the literal string `undefined` into every URL it builds. `serverUrl` is a required field here, and a test sets the ambient variable to a decoy to prove the output does not move.

The fixture's claims give `workflowRef` and `jobWorkflowRef` **different** values (a reusable workflow in another repository). Upstream builds the builder id from one and the workflow path from the other; with them equal, a constructor that confuses the two passes every assertion — a survived mutant found exactly that.

### Signing

`SigstoreSigner.layer` (public-good) and `layerWith(options)`, where the options bag carries `fulcioBaseUrl` / `rekorBaseUrl` (the staging e2e) **and** `signer` / `witnesses` (the test seam) — one entry point rather than two. `SigningError.kind` is chosen by reading `@sigstore/sign`'s own `InternalError.code` (`CA_*`, `TLOG_*`, `TSA_*`, `IDENTITY_TOKEN_*`); an unattributable failure is `bundle`, literally "the bundle did not get built", rather than guessed into a step. `describeSigstoreError` has no successor, as designed.

`SigstoreBundle.mediaType` is **carried through from the builder**, not declared as a literal — `toDSSEBundle` picks v0.2 or v0.3 depending on whether a certificate chain is present, and a literal would quietly lie. The v0.3 constant this package exports is checked against `@sigstore/bundle`'s own `BUNDLE_V03_MEDIA_TYPE` in the signer's test file, which is the one place allowed to import it.

Two facts that only surfaced by running it, both now pinned: an **unwitnessed bundle has no `tlogEntries` key at all** (protobuf JSON omits empty repeated fields), and the stub signer receives the DSSE **pre-authentication encoding** rather than the payload — which is the discriminating proof that the real builder ran.

### The reachability walker, and a trap worth naming

The suite follows the Phase 2 precedent, with a control (the signer *does* reach `@sigstore/*`) and an honest exemption for the entry point, which re-exports the signer.

**Its comment-stripping order is load-bearing and the inherited order was wrong.** Stripping block comments before line comments lets the token `` `@sigstore/*` `` in prose open a block comment, deleting everything from that word to the end of the next doc comment — imports included. A module importing `effect` was reported as importing nothing: an under-reporting walker makes a confinement test pass for the wrong reason. Line comments come out first here. Sibling packages that copied the walker have the opposite order and are safe only while no prose in them contains `/*`.

### Verification

123 tests; `types:check` and Biome clean; `pnpm build --filter @effected/sbom` reports `buildOk: true` with zero warnings and 20 suppressed `_base` forgotten-exports. **Fifty-six mutants were run against the implementation and all but two went red on the first pass**; both survivors were real test weaknesses rather than false alarms — `merge` precedence asserted on one field of four, and the provenance fixture's two workflow refs set equal — and both were fixed rather than waived.

One API-gate lesson repeated here: two `@public` input interfaces spell their shared members out twice rather than extend a private base, because an internal type named on a public signature is a forgotten export and a named alias is still a named symbol.

## Open questions

1. ~~**Does `@effected/package-json` get `repository` normalization and the `bugs`/`homepage` fields as part of this phase, or as a separate change first?**~~ **SETTLED as recommended:** separate and first, landed before this package (2026-07-25). The derivation consumes `Person.FromValue`, `Repository.browseUrl`, `Bugs.url`, `homepage`, `maintainers` and `keywords`, and hand-rolls none of them.
2. ~~**Should `SbomDocument` target CycloneDX 1.6 or 1.5?**~~ **SETTLED (Spencer, 2026-07-25): 1.6 only.** The emitter ships **no 1.5 path** — one target version, no dual-emission branch and no version option. v3's 1.5 output is superseded rather than supported. This also unlocks `component.tags` and the plural `component.authors`, both of which the [metadata mapping](#the-metadata-derivation-split) now reads.
3. **Does anything need the CycloneDX `dependencies` graph, or is a flat component list sufficient?** NTIA element 5 ("dependency relationship") is satisfied by the flat list plus the root's `dependsOn` in v3's shape, but a real transitive graph is more useful and `@effected/lockfiles` could supply one. **Still deferred at implementation** — no consumer has asked, and the flat form is NTIA-sufficient. As built, element 5 asks for a declared root rather than for a graph, so adding one later is additive: a `dependencies` array plus a stronger check, with no change to what the element means.
