# @effected/sbom

Supply-chain artifacts as Effect schemas: a CycloneDX 1.6 SBOM emitter, the
NTIA minimum-elements report, in-toto Statement v1, the SLSA Provenance v1
predicate, and Sigstore DSSE signing. **Integrated tier**, but only barely and
only in one module: `@sigstore/sign` and `@sigstore/bundle` are real runtime
dependencies — this is cryptography against Fulcio and Rekor, and
re-implementing it would be a security defect rather than a bug — while every
other module is pure computation over owned models.
`@cyclonedx/cyclonedx-library` is deliberately absent (6.6 MB and seven
optional peers for ~10 symbols an emitter uses). Pure edges only otherwise:
`@effected/spdx` for license identifiers and expressions, and
`@effected/package-json` **type-only in `src/`**. There is no `@effected/github`
edge in either direction — a bundle crosses that seam as a structural JSON
value.

## Import

```ts
import { InTotoStatement, NtiaReport, Sbom, SbomMetadataSource, Sha256Digest, SigstoreSigner } from "@effected/sbom";
import { Package } from "@effected/sbom"; // re-exported from @effected/package-json
```

Single entrypoint; no subpaths. `Package`, `Person` and `Repository` are
re-exported so a caller can name a `SbomMetadataSource` argument type without
declaring `@effected/package-json` itself.

## Feature surface

| Reach for | When |
| --- | --- |
| `Sbom` | assembling, serializing or writing a CycloneDX 1.6 document |
| `SbomMetadataSource` | deriving CycloneDX components and metadata from a `package.json` — purls, root component, external references, copyright |
| `SbomDocument`, `Component`, `SbomMetadata`, `Supplier`, `Contact`, `ExternalReference` | the owned model, when you assemble entries yourself |
| `NtiaReport` | checking a document against the seven NTIA minimum elements before publishing it |
| `InTotoStatement`, `InTotoSubject`, `Sha256Digest` | wrapping a predicate (provenance, a BOM, your own) around a content-addressed subject |
| `SlsaProvenance` | building the SLSA Provenance v1 predicate for a GitHub Actions build |
| `SigstoreSigner`, `IdentityToken`, `SigstoreBundle` | signing a statement into a DSSE bundle, and supplying the OIDC token that makes it possible |
| the constants (`CYCLONEDX_BOM_PREDICATE`, `IN_TOTO_STATEMENT_V1`, `IN_TOTO_PAYLOAD_TYPE`, `SLSA_PROVENANCE_V1`, `GITHUB_BUILD_TYPE`, `SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE`, `SIGSTORE_OIDC_AUDIENCE`) | naming a predicate, payload or media type on the wire |

`supply-chain-attestation` teaches the pipeline task-by-task — generate, sign,
upload; this file is the surface map. Uploading a bundle is
`@effected/github`'s `Attestation`, and the Actions-side adapters
(`ActionsProvenance`, `ActionsIdentityToken`) are `@effected/github-actions`'s.

## Core API

- **`Sbom`** — a static class with a private constructor, not a namespace
  object. `Sbom.generate(input: SbomInput)` → `SbomDocument` and
  `Sbom.toJson(document, { space? })` → `string` are both **total** — an owned
  model over validated `Schema.Class` values has nothing to fail at.
  `Sbom.write(document, path, options?)` → `Effect<void, SbomWriteError,
  FileSystem>` is the package's only IO and its only error. `generate` sorts
  components by name so two runs over the same inputs produce the same bytes —
  an SBOM's digest becomes an attestation subject, and a document that reordered
  itself would change that digest for no reason. `write` does **not** create
  parent directories, deliberately: the failure stays "the path you gave me is
  not writable" rather than "something was created somewhere".
- **`SbomInput`** — `{ root: Component, components: ReadonlyArray<Component>,
  metadata?: SbomMetadata }`. `root` is threaded onto the metadata
  automatically, which is why `SbomMetadataSource.fromPackage` does not set it.
- **`SbomMetadataSource`** — the manifest → CycloneDX derivation, also a static
  class: `npmPurl(name, version?)`, `componentFor(ComponentInput)`,
  `rootComponent(pkg, options?)`, `externalReferences(pkg, options?)`,
  `fromPackage(pkg, options?)`, `formatCopyright(holder, { startYear?, year })`,
  `merge(base, override)` (field-wise, override wins — a helper, not a
  precedence policy). `SbomMetadataOptions` carries `supplier`, `authors` and
  `timestamp` as **explicit-only**: a `package.json` never says who supplied the
  software, who assembled the BOM, or when, and deriving them would fabricate
  three of the seven NTIA elements. `externalReferences` maps four of the
  specification's 43 types, one per manifest field (`vcs` ← `repository`,
  `issue-tracker` ← `bugs`, `documentation` ← `homepage`, `website` ← the
  supplier's first URL) and emits **no** reference for a `repository` value the
  package-json model cannot interpret, rather than passing `owner/name` through
  into a field the spec says is a URL.
- **`SbomDocument` and friends** — `bomFormat: "CycloneDX"`, `specVersion:
  "1.6"` (1.6 only: no 1.5 path, no dual emission, no version option),
  `version`, `metadata?`, `components`. `Component` carries `type` (`library |
  application | framework`), `name`, and optional `version`, `purl`, `bomRef`,
  `description`, `licenses`, `externalReferences`, `tags`, `authors`,
  `publisher`, `copyright`. **`bomRef` is spelled `bom-ref` in the emitted
  JSON**, renamed inside `toJson`; emitting `bomRef` produces a document that
  looks correct and validates wrong.
- **`NtiaReport`** — `NtiaReport.of(document)` is **total**; the value carries
  `elements: NtiaElement[]` (one verdict each), `compliant` and `missing:
  NtiaElementId[]`. The ids are a literal union — `supplierName`,
  `componentName`, `componentVersion`, `uniqueIdentifier`,
  `dependencyRelationship`, `sbomAuthor`, `timestamp` — because that is what a
  consumer branches on; a display name is what it renders afterwards.
- **`Sha256Digest`** — a branded 64-character lowercase hex string, no algorithm
  prefix: `Sha256Digest.isValid`, `.parseResult` (sync `Result`), `.parse`
  (`Effect`, failing `InvalidSha256DigestError`). A deliberate small duplication
  of what `@effected/github` types structurally on its attestation surface.
- **`InTotoStatement`** — `of({ subject, predicateType, predicate })` and
  `forSubject({ name, digest, predicateType, predicate })`, both **total**;
  `toJson({ space? })` emits the bytes a DSSE envelope carries, compact and in a
  fixed key order by default so the same statement serializes identically every
  run. `predicate` is `unknown` by design and `PredicateType` is an open
  `string`, not a union — the vocabulary is extensible, and a closed union would
  refuse a valid statement. `InTotoSubject.forSha256(name, digest)` is the
  constructor; `name` is conventionally a purl.
- **`SlsaProvenance`** — `SlsaProvenance.forGitHubWorkflow(input)` is a **total,
  pure projection** of its `GitHubWorkflowProvenance` argument: twelve fields
  (`serverUrl`, `repository`, `ref`, `sha`, `eventName`, `workflowRef`,
  `jobWorkflowRef`, `repositoryId`, `repositoryOwnerId`, `runnerEnvironment`,
  `runId`, `runAttempt`), all required, **nothing read from the environment**.
  `SlsaProvenance.predicateType` and `.buildType` are the two URIs a statement
  and a build definition must declare. Note that `workflowRef` and
  `jobWorkflowRef` are genuinely different values — the builder id comes from
  one, the workflow path from the other, and code that confuses them passes any
  test that sets them equal.
- **`SigstoreSigner`** — `Context.Service` with one member,
  `sign(statement: InTotoStatement)` → `Effect<SigstoreBundle, SigningError>`.
  `SigstoreSigner.layer` requires `IdentityToken` and signs against the
  public-good Fulcio and Rekor; `layerWith({ fulcioBaseUrl?, rekorBaseUrl?,
  signer?, witnesses? })` swaps the endpoints (Sigstore **staging**) or replaces
  the signer/witness pair outright. The identity token is fetched, declassified
  and discarded **inside** `sign`, which is why the method takes only a statement
  — `SIGSTORE_OIDC_AUDIENCE` is the protocol's requirement, not the caller's
  knowledge.
- **`SigningError`** — `kind: identity | certificate | transparencyLog | bundle`,
  plus `cause: Defect`. Sized to what a caller can act on: `identity` is a
  workflow-permissions problem, `certificate` is Fulcio, `transparencyLog` is
  Rekor, `bundle` is everything else. The `kind` is read off Sigstore's own
  `InternalError.code` (`CA_*`, `TLOG_*`, `TSA_*`, `IDENTITY_TOKEN_*`); an
  unattributable failure is `bundle` rather than guessed into a step.
- **`IdentityToken`** — the inverted OIDC contract, one method:
  `token(audience)` → `Effect<Redacted<string>, IdentityTokenError>`.
  `IdentityToken.layerStatic(token)` answers with a token the caller already
  holds and **ignores the audience** — minting it for the right audience is the
  caller's job, and a layer that pretended to check would be theatre.
- **`SigstoreBundle`** — `{ mediaType, verificationMaterial, dsseEnvelope }`.
  The latter two are `unknown` because their shapes belong to the Sigstore
  protobuf specs; `mediaType` is carried through from what the builder produced
  rather than asserted to the v0.3 constant.

## Testing machinery

The two doubles default differently, on purpose.
**`SigstoreSigner.makeTest().sign` dies** unless stubbed — a fabricated bundle
would be a signature-shaped lie, which is exactly the failure an attestation
exists to prevent; the strongest case in the kit for the die-loudly default. A
test that wants a real bundle without a network drives the **real**
`DSSEBundleBuilder` through `SigstoreSigner.layerWith({ signer, witnesses })`.
**`IdentityToken.makeTest` answers** — a fabricated OIDC token is a real answer
to "give me a token". Both also ship `layerTest(overrides?)`.

## Gotchas

- **Never introduce a namespace object** — an `Sbom = { generate, sign }`
  convenience would put Fulcio's HTTP stack on every SBOM-only consumer's graph,
  silently. `__test__/reachability.test.ts` walks the runtime import graph and
  asserts the wall, with a control so the suite can fail. `Sbom` and
  `SbomMetadataSource` are static classes rather than `as const` objects because
  an `as const` object's member types are inferred in the built `.d.ts` and lose
  their TSDoc.
- **`SbomMetadataSource` imports `Package` as a TYPE only.** A value import
  would drag `@effected/package-json`'s `FileSystem` IO module onto the runtime
  graph. The entry point's value re-export is the one sanctioned place; do not
  copy the pattern into `src/`.
- **A license is an EXPRESSION field, and CycloneDX renders three shapes.**
  `{license:{id}}` only for a catalog identifier, a one-element
  `[{expression}]` tuple for an expression, `{license:{name}}` for anything
  else. Emitting every value as an `id` produces a document that looks right and
  fails validation. The id-versus-expression question belongs to
  `@effected/spdx` (`License.isKnownId`, `isValidExpression`) — **never** a local
  regex.
- **The purl is `pkg:npm/%40scope/name@version`.** The scope is the purl
  *namespace*: the `@` is percent-encoded and the separating slash stays
  literal. `encodeURIComponent(name)` collapses that slash to `%2F` and parses
  back as a namespace-less name.
- **Nothing here reads an ambient clock or environment.** `formatCopyright`
  takes the year, `SbomMetadata.timestamp` is supplied, and
  `GitHubWorkflowProvenance.serverUrl` is required — upstream `@actions/attest`
  reads `GITHUB_SERVER_URL` with no default and writes the literal string
  `undefined` into every URL when it is unset.
- **An unwitnessed bundle has no `tlogEntries` key at all.** Protobuf JSON omits
  empty repeated fields, so a bundle signed with `witnesses: []` carries no such
  property; `.tlogEntries.length` throws on a legitimately unwitnessed bundle.
- **When porting anything else into this package, audit every error channel for
  whether it can actually fire.** Three were deleted here — two guarding a
  library that no longer exists, one checking a required field for absence.
