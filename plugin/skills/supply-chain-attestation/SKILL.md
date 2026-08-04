---
name: supply-chain-attestation
description: Use when generating a CycloneDX SBOM, checking NTIA minimum elements, building an in-toto statement or a SLSA provenance predicate, signing into a Sigstore DSSE bundle, or uploading an attestation to GitHub.
when_to_use: Sbom.generate, NtiaReport, InTotoStatement, SlsaProvenance, SigstoreSigner, OidcTokenIssuer, ActionsProvenance, ActionsIdentityToken, Attestation.upload
---

# Supply-chain attestation

The end-to-end pipeline spans **three packages**, which is why it is one skill
rather than a `@effected/sbom` API reference: `@effected/sbom` (the SBOM
emitter, the statement/provenance models, the signer), `@effected/github-actions`
(the OIDC token the signer needs), and `@effected/github` (the REST upload).
None of the three packages import each other for this — the seams are the
point. Do not restate general Effect v4 service/layer or schema rules here;
see `effect-v4-services-layers`, `effect-v4-schema`, `effect-v4-testing`,
`effected-packages`.

`@effected/sbom` is two independent capabilities wearing one package: emitting
an SBOM is pure computation over a manifest, and signing is network-bound
cryptography against Fulcio and Rekor. Every rule below exists to keep an
SBOM-only consumer from reaching Sigstore's transport, and vice versa
(`packages/sbom/CLAUDE.md`).

## The pipeline

A worked, composable example — the shape a release action actually runs.

### 1. Emit the SBOM — `Sbom.generate` / `Sbom.toJson` / `Sbom.write`

Both `generate` and `toJson` are **total, plain functions — no error
channel** (`packages/sbom/src/Sbom.ts:67-103`). `write` is the package's only
IO, over core `FileSystem` (`Sbom.ts:113-118`):

```ts
import { Sbom, SbomMetadataSource } from "@effected/sbom";

const root = SbomMetadataSource.rootComponent(pkg, { supplier, timestamp });
const metadata = SbomMetadataSource.fromPackage(pkg, { supplier, timestamp });
const document = Sbom.generate({ root, components, metadata });
const json = Sbom.toJson(document); // total — no yield*, no layer
yield* Sbom.write(document, sbomPath); // the one fallible member; FileSystem in R
```

`generate` sorts `components` by name so two runs over the same inputs
produce the same bytes — the document's digest becomes an attestation
subject later in the pipeline, and reordering it between runs would change
that digest for no reason (`Sbom.ts:59-74`).

`SbomMetadataSource` derives from a `Package` manifest
(`packages/sbom/src/SbomMetadataSource.ts`). `supplier`, `authors` and
`timestamp` are **explicit-only** — a manifest says who wrote the software,
never who supplied it, who assembled the BOM, or when; deriving any of them
would fabricate three of the seven NTIA elements (`SbomMetadataSource.ts:62-87`).
`Package` is imported there as a **type only** (`SbomMetadataSource.ts:20`) —
see [Keeping a light consumer light](#keeping-a-light-consumer-light). The
package **entrypoint** re-exports `Package`, `Person` and `Repository` from
`@effected/package-json` (`packages/sbom/src/index.ts:14`), so a consumer
constructing metadata inputs imports them from `@effected/sbom` without
adding the `package-json` edge itself.

### 2. Check `NtiaReport` — the seven minimum elements

`NtiaReport.of(document)` is **total** — it returns a report for every input,
including one that satisfies nothing (`packages/sbom/src/NtiaReport.ts:173-186`):

```ts
import { NtiaReport } from "@effected/sbom";
import { Effect } from "effect";

const report = NtiaReport.of(document);
if (!report.compliant) yield* Effect.logWarning(`SBOM missing: ${report.missing.join(", ")}`);
```

`compliant` and `missing` are derived getters, not a pass/fail assertion — a
caller wanting a hard gate writes its own `Effect.fail` at its own boundary
(`NtiaReport.ts:159-167`). `id` is a stable literal union
(`supplierName` | `componentName` | `componentVersion` | `uniqueIdentifier` |
`dependencyRelationship` | `sbomAuthor` | `timestamp`,
`NtiaReport.ts:30-38`) — a consumer branches on `id`, never on a rendered
name; there is no `suggestion` field, because a library cannot know a
consumer's remediation config.

### 3. Build the statement and predicate — `InTotoStatement`, `SlsaProvenance`

`InTotoSubject.forSha256` needs a validated digest —
`Sha256Digest.parse`/`parseResult` strip an optional `sha256:` prefix and
lowercase the hex (`packages/sbom/src/InTotoStatement.ts:82-108`):

```ts
import { InTotoStatement, Sha256Digest, SlsaProvenance } from "@effected/sbom";
import { Effect } from "effect";

const digest = yield* Sha256Digest.parse(tarballDigestHex);
const predicate = SlsaProvenance.forGitHubWorkflow(claims); // total, no ambient env
const statement = InTotoStatement.forSubject({
  name: SbomMetadataSource.npmPurl(pkg.name, pkg.version.toString()),
  digest,
  predicateType: SlsaProvenance.predicateType,
  predicate,
});
```

**An Actions consumer does not hand-assemble `claims` →
`GitHubWorkflowProvenance`.** `ActionsProvenance.capture(audience?)` in
`@effected/github-actions` reads `OidcTokenIssuer.claims` plus
`GITHUB_SERVER_URL` (defaulted to `https://github.com` — absence is not a
failure, only GHES sets it) and returns the `SlsaProvenance` directly. The
hand mapping is eleven same-typed string renames where transposing
`repository_id`/`repository_owner_id` compiles clean and signs a wrong
attestation; `capture` exists to make that unwritable. The typed
`OidcTokenError` passes through — catch-and-skip vs mandatory attestation is
the caller's policy, not the kit's.

`SlsaProvenance.forGitHubWorkflow` is **total, a pure projection** —
upstream `@actions/attest` reads `process.env.GITHUB_SERVER_URL` with no
default and writes the literal string `"undefined"` into every URL it builds
when it is unset; `GitHubWorkflowProvenance.serverUrl` is a **required
field** here instead, and a test sets the ambient variable to a decoy and
asserts the output does not move
(`packages/sbom/src/SlsaProvenance.ts:1-23`, test at
`packages/sbom/__test__/SlsaProvenance.test.ts:73-85`). `GitHubWorkflowProvenance`
is a **plain input record, not a contract service** — there is nothing to
swap and no IO to invert (`SlsaProvenance.ts:110-125`).

### 4. `IdentityToken` — the program's third inverted contract

Signing needs a workload identity token. Issuing one needs the Actions
runtime (`ACTIONS_ID_TOKEN_REQUEST_URL`, a platform HTTP client), which lives
in `@effected/github-actions` — an integrated package with a **required**
`@effect/platform-node` peer. `@effected/sbom` must not take that edge, so
the dependency is inverted, joining `@effected/npm`'s `CatalogResolver` and
`@effected/commands`' `LocalExec`:

```ts
export interface IdentityTokenShape {
  readonly token: (audience: string) => Effect.Effect<Redacted.Redacted<string>, IdentityTokenError>;
}
```

(`packages/sbom/src/IdentityToken.ts:50-53`). `sbom` declares the contract;
`github-actions` ships `OidcTokenIssuer`, whose runner half reads
`ACTIONS_ID_TOKEN_REQUEST_TOKEN`/`_URL` and decodes claims
(`packages/github-actions/src/OidcTokenIssuer.ts:90-222`). **The adapter
ships — do not hand-roll it** (it lived in every consumer until dogfood
round 1, 2026-07-26):

```ts
import { ActionsIdentityToken, OidcTokenIssuer } from "@effected/github-actions";
import { SigstoreSigner } from "@effected/sbom";
import { Layer } from "effect";

const signing = SigstoreSigner.layer.pipe(
  Layer.provide(ActionsIdentityToken.layer), // Layer<IdentityToken, never, OidcTokenIssuer>
  Layer.provide(OidcTokenIssuer.layer),
);
```

Outside Actions, hand `sign` a token you already hold via
`IdentityToken.layerStatic`.

**The audience constant stays in `sbom`**, not the caller:
`SIGSTORE_OIDC_AUDIENCE = "sigstore"` is Sigstore's requirement, not the
caller's knowledge, which is why `sign` takes only a statement and asks the
contract for a token itself rather than `sign(statement, { token })`
(`packages/sbom/src/SigstoreSigner.ts:25-38`).

### 5. Sign — `SigstoreSigner` → `SigstoreBundle`

```ts
import { SigstoreSigner } from "@effected/sbom";
import { Effect, Layer } from "effect";

const bundle = yield* Effect.gen(function* () {
  const signer = yield* SigstoreSigner;
  return yield* signer.sign(statement);
}).pipe(Effect.provide(SigstoreSigner.layer.pipe(Layer.provide(ActionsIdentityToken.layer), Layer.provide(OidcTokenIssuer.layer))));
```

`SigstoreSigner.layer` signs against the public-good Fulcio/Rekor instances;
`SigstoreSigner.layerWith({ fulcioBaseUrl, rekorBaseUrl, signer, witnesses })`
is one entry point for both the Sigstore **staging** e2e and the test seam —
see [Testing](#testing).

### 6. Upload — `@effected/github`'s `Attestation.upload`

```ts
import { Attestation, Repo } from "@effected/github";
import { Effect } from "effect";

const record = yield* Attestation.upload(bundle).pipe(Effect.provide(Repo.layer({ owner, repo })));
```

`upload` types `bundle` as `unknown` (`packages/github/src/Attestation.ts:66-68`)
— the `SigstoreBundle` crosses this seam as a **structural JSON value**
(`{ mediaType, verificationMaterial, dsseEnvelope }`), never as `sbom`'s
class. **There is no edge between `sbom` and `github` in either direction**;
`github` types the parameter structurally and the consumer wires the two
together (`.claude/design/effected/packages/sbom.md#the-attestation-seam-no-edge-either-way`).
It is the same call `github` already made for `Sha256Digest` vs
`@effected/lockfiles`' `IntegrityHash` — a small deliberate duplication
beats dragging a package across a seam.

## Keeping a light consumer light

- **Never introduce a namespace object.** An `Sbom = { generate, sign }`
  convenience would make every SBOM consumer reachable to Fulcio's HTTP
  stack, silently — the config-file codec rule with sharper teeth.
  `packages/sbom/__test__/reachability.test.ts` measures the confinement
  with a control (the signer *does* reach `@sigstore/*`,
  `reachability.test.ts:106-111`) so the suite can fail; the entry point
  legitimately reaches the signer because it re-exports it
  (`reachability.test.ts:143-150`), and the property that matters is that
  every pure module is reachable **without** it.
- **`@sigstore/*` is confined to `SigstoreSigner.ts` only.**
  `SigstoreBundle.ts` imports **nothing** from `@sigstore/*` — its media-type
  constant is written out as a literal and checked against
  `@sigstore/bundle`'s own `BUNDLE_V03_MEDIA_TYPE` in the *signer's* test
  file, the one place allowed to import it
  (`packages/sbom/src/SigstoreBundle.ts:1-22`, `SigstoreSigner.test.ts:96-103`).
- **`SbomMetadataSource` imports `Package` as a type only**
  (`SbomMetadataSource.ts:20`). A value import would put
  `@effected/package-json` — and its `FileSystem` IO module — on the runtime
  graph of an otherwise-pure half; the reachability suite asserts the exact
  edge set (`reachability.test.ts:127-134`).
- **The reachability walker strips LINE comments before block comments,
  deliberately.** This package's own prose contains the token
  `` `@sigstore/*` ``, whose `/*` opens a block comment as far as a naive
  regex is concerned; stripping blocks first deletes everything from that
  word to the next doc comment's close — imports included — and reports a
  module that imports `effect` as importing nothing
  (`reachability.test.ts:16-47`, self-test at `:85-104`). It fails in the
  *safe* direction, which for a confinement test is the worst direction.
  Sibling packages that copied this walker with the opposite order are safe
  only by luck.
- **Why `@cyclonedx/cyclonedx-library` is absent, and when that reverses.**
  6.6 MB, seven optional peers, ~10 symbols used — an object model and a
  JSON normalizer. The parts that earn the weight (XML output, ajv schema
  validation, SPDX expression parsing) are exactly the parts an emitter
  never calls, and its `spdx-expression-parse` peer would install a second
  SPDX engine beside `@effected/spdx`. Recorded reversal triggers: CycloneDX
  **XML** output, or *consuming and validating* third-party BOMs — neither
  is anyone's need today (`packages/sbom/CLAUDE.md:26-32`).
- **`@sigstore/sign` + `@sigstore/bundle` are taken outright.** Real
  cryptography and a wire protocol against Fulcio and Rekor — re-implementing
  either is a security defect, not a bug. Confine it, don't avoid it.

## The traps

**A license is an expression field, and CycloneDX renders three shapes.**
`MIT`, `MIT OR Apache-2.0` and `UNLICENSED` are all legal `package.json`
`license` values. The schema constrains `license.id` to the SPDX
identifier enumeration, so emitting every value as `{ license: { id } }`
produces a document that looks right and fails validation — a real defect
found and fixed in this package. The emitter picks between three shapes
(`packages/sbom/src/SbomDocument.ts:190-212`):

| Input | Emitted | Chosen by |
| --- | --- | --- |
| a catalog identifier (`MIT`) | `[{ license: { id } }]` | `License.isKnownId` |
| an expression (`MIT OR Apache-2.0`) | `[{ expression }]` — a one-element tuple | `isValidExpression` |
| anything else (`UNLICENSED`, `SEE LICENSE IN …`) | `[{ license: { name } }]` | neither |

The expression tuple is exclusive (`maxItems: 1`), so an expression among
several licenses degrades to a named license rather than an invalid
document. The id-versus-expression question is `@effected/spdx`'s
(`License.isKnownId`, `isValidExpression`) — **never** a local regex.

**The purl is `pkg:npm/%40scope/name@version`.** The scope is the purl
**namespace**, not part of the name: the `@` is percent-encoded, the
separating slash stays literal — the package-url spec's own npm roundtrip
vector (`pkg:npm/%40angular/animation@12.3.1`).
`encodeURIComponent(name)` collapses that slash to `%2F` and parses back as
a namespace-less name (`packages/sbom/src/SbomMetadataSource.ts:25-46`).
Versions pass through verbatim — every character semver permits is a legal
RFC 3986 path character, so encoding them would produce a longer string
meaning the same thing.

**An unwitnessed bundle has no `tlogEntries` key at all.** Protobuf JSON
omits empty repeated fields, so signing with `witnesses: []` produces
verification material with **no** `tlogEntries` property, not an empty
array (`SigstoreSigner.test.ts:145-156`). Reading `.tlogEntries.length`
blindly throws on a legitimately unwitnessed bundle.

**Three error channels the port deleted, and why they could not fire.**
`Sbom.generate`/`toJson` were `Effect<_, SbomError>` with
`reason: "build" | "serialize"` — failures possible only because the
CycloneDX *library* might throw, a possibility introduced by the
dependency. `SlsaError { reason: "env" }` guarded string interpolation over
already-present claims. NTIA's "dependency relationship" check was
`sbom.components !== undefined` against a field this model declares
**required** — a check that cannot fail. Owned models over validated
`Schema.Class` values cannot fail this way, so all three are plain
functions now. **Generalize the rule: audit every ported error channel for
whether it can actually fire** — three in one source package is a pattern,
not a coincidence.

**The signer's error `kind` comes from Sigstore's own error codes.**
`kindOf` reads `@sigstore/sign`'s `InternalError.code`
(`CA_*` → `certificate`, `TLOG_*`/`TSA_*` → `transparencyLog`,
`IDENTITY_TOKEN_*` → `identity`), and `cause: Schema.Defect()` keeps the
original failure structurally (`packages/sbom/src/SigstoreSigner.ts:84-94`).
That is why the predecessor's 30-line recursive cause-chain-to-string
flattener has **no successor** — it existed because the error was about to
become a message. An unattributable failure is `kind: "bundle"` — literally
"the bundle did not get built" — rather than guessed into a step it may not
belong to.

**The oracle rule for ported cryptography: when an implementation and a
remembered constant disagree, neither is the oracle.** The purl bug was
found this way — climb to a **published** intermediate (the package-url
spec's own roundtrip vectors) and export the internal steps so the oracle
stays external. Never pin your own output as the fixture; `conformance.test.ts`
derives its expectations from the vendored CycloneDX schema itself rather
than hand-writing them, for exactly this reason.

## Testing

General rules live in `testing-actions` and `effect-v4-testing` — this
section is what's specific to signing and attestation.

- **Two vendored oracles**, both under `packages/sbom/__test__/fixtures/`
  with a `VENDORED.md` pin: the published CycloneDX 1.6 JSON schema (used
  by `conformance.test.ts` to derive `required`/`enum` expectations rather
  than hand-write them), and `@actions/attest`'s own predicate output for a
  fixed claim set, transcribed from `actions/toolkit` source
  (`SlsaProvenance.test.ts` asserts a **deep-equal**, so an extra field
  fails as loudly as a missing one).
- **`workflowRef` and `jobWorkflowRef` are deliberately different** in that
  fixture — a reusable workflow in another repository. Upstream builds the
  builder id from one and the workflow path from the other; set equal, a
  constructor that confuses them passes everything. A survived mutant found
  exactly that (`SlsaProvenance.test.ts:26-32`) — do not collapse them in a
  new fixture.
- **`SigstoreSigner.makeTest().sign` dies** unstubbed — a fabricated bundle
  would be a signature-shaped lie, the strongest case in the kit for the
  die-loudly default (`SigstoreSigner.ts:176-226`). Contrast
  **`IdentityToken.makeTest` answers** — a fabricated OIDC token is a real
  answer to "give me a token", the same judgment that made
  `LocalExec.makeTest` return `Option.none()` (`IdentityToken.ts:89-99`).
- **The stub-`Signer`-through-the-real-`DSSEBundleBuilder` recipe**: supply
  a stub `Signer`/`Witness` by interface and let the real builder run, so
  DSSE pre-authentication encoding, envelope assembly and protobuf
  serialization are genuinely exercised. The discriminating assertion is
  that the stub signer receives the pre-authentication encoding
  (`DSSEv1` + length-prefixed type + length-prefixed body, all one
  space-separated string) — a hand-rolled fake would sign the raw JSON instead
  (`SigstoreSigner.test.ts:119-134`).
- **An opt-in Sigstore staging e2e** via
  `SigstoreSigner.layerWith({ fulcioBaseUrl, rekorBaseUrl })` catches
  upstream protocol drift; it is not a gate and never runs in default CI.

## Related skills

`actions-runtime`, `actions-state-and-secrets`, `github-api` and
`release-and-publish` cover the surrounding runner, state, REST-client and
release-composition concerns; they are being authored in parallel with this
one.
