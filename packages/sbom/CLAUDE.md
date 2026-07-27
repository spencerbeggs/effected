# @effected/sbom

Software-supply-chain artifacts: a CycloneDX 1.6 SBOM, the NTIA minimum-elements
report, in-toto statements and SLSA provenance, and Sigstore DSSE signing.
Phase 4 of the GitHub/Actions split — the middle piece of the old `Attest` knot,
whose other two are `@effected/github`'s `Attestation` (the REST surface) and
consumer composition (the pipeline).

**Design doc:** `@../../.claude/design/effected/packages/sbom.md`

## Tier: integrated

`@sigstore/sign` + `@sigstore/bundle` are real runtime dependencies — this is
cryptography and a wire protocol against Fulcio and Rekor, and re-implementing
either is a security defect rather than a bug. The design question was never
*whether* to be integrated but **how small the integrated surface is**: one
module, ~380 KB.

| Edge | Why |
| --- | --- |
| `@sigstore/sign`, `@sigstore/bundle` | signing. **`SigstoreSigner.ts` only** |
| `@effected/spdx` (`workspace:~`) | license identifier vs expression, on components |
| `@effected/package-json` (`workspace:~`) | manifest-derived metadata (**type-only** in `src/`; `Package` / `Person` / `Repository` re-exported from the entry point) |
| `effect` (peer) | core |

**`@cyclonedx/cyclonedx-library` is deliberately absent** — 6.6 MB with seven
optional peer dependencies for ~10 used symbols, all of them an object model and
a JSON normalizer. The parts that earn the weight (XML, ajv validation, SPDX
expression parsing) are exactly the parts an emitter never calls, and its
`spdx-expression-parse` peer would have installed a second SPDX engine beside
our own. Reversal triggers, recorded: CycloneDX **XML** output, or *consuming
and validating* third-party BOMs. Neither is anyone's need today.

**No `@effected/github` edge, in either direction.** A `SigstoreBundle` crosses
that seam as a structural JSON value (`{ mediaType, verificationMaterial,
dsseEnvelope }`); github types the parameter structurally and the consumer wires
the two together.

## Two capabilities, and the wall between them

Emitting an SBOM is pure computation over a manifest. Signing is network-bound
cryptography. **A consumer that only wants an SBOM must not reach
`@sigstore/*`**, and that is the constraint driving the module split more than
anything else.

`__test__/reachability.test.ts` walks the runtime import graph and asserts it,
with a control (the signer *does* reach Sigstore) so the suite can fail. The
entry point legitimately reaches the signer — it re-exports it — and the test
says so rather than pretending otherwise; the property that matters is that
every pure module is reachable **without** it.

**Never introduce a namespace object** — a `Sbom = { generate, sign }`
convenience would make every SBOM consumer reachable to Fulcio's HTTP stack,
silently. This is the [config-file codec rule](../config-file/CLAUDE.md) with
sharper teeth.

## Source modules

- `SbomDocument.ts` — the owned CycloneDX 1.6 model and the JSON normalizer.
  **1.6 only**: no 1.5 path, no dual-emission branch, no version option.
- `Sbom.ts` — `generate` / `toJson` (both **total**, plain functions) and
  `write` (the package's only IO, over core `FileSystem`).
- `SbomMetadataSource.ts` — manifest → CycloneDX derivation: `npmPurl`,
  `componentFor`, `rootComponent`, `externalReferences`, `fromPackage`,
  `formatCopyright`, `merge`.

`Sbom` and `SbomMetadataSource` are static classes with a private constructor,
not `as const` namespace objects — an `as const` object's member types are
inferred in the built `.d.ts` and lose their TSDoc; `static readonly` keeps
it. Call syntax is unaffected (`Sbom.generate(...)`), and the conversion
stayed within each file — no new imports, so the reachability wall holds.

- `NtiaReport.ts` — the seven minimum elements as a report.
- `InTotoStatement.ts` — `Sha256Digest`, `InTotoSubject`, `InTotoStatement`.
- `SlsaProvenance.ts` — the typed SLSA Provenance v1 predicate.
- `SigstoreBundle.ts` — the bundle value and the media-type constants. Imports
  **nothing** from `@sigstore/*`.
- `SigstoreSigner.ts` — the service, its layers, `SigningError`. The **only**
  module importing `@sigstore/*`.
- `IdentityToken.ts` — the inverted OIDC contract.

## The things that will bite you

### Three error channels the port deleted, and why they could not fire

`Sbom.generate` and `Sbom.toJson` were `Effect<_, SbomError>` with
`reason: "build" | "serialize"` — failures that existed only because the
CycloneDX library might throw. `SlsaError { reason: "env" }` guarded string
interpolation over already-present claims. The NTIA "dependency relationship"
check was `sbom.components !== undefined` against a **required** field.

Owned models over validated `Schema.Class` values cannot fail, so those are
plain functions now. `write` keeps an error channel because the filesystem has
one. **When porting anything else from that source package, audit every error
channel for whether it can actually fire** — three in one package is a pattern.

### A license is an EXPRESSION field, and CycloneDX renders three shapes

`MIT`, `MIT OR Apache-2.0` and `UNLICENSED` are all legal `package.json`
licenses and all serialize differently: `{license:{id}}` only for a catalog
identifier (the schema constrains `id` to the SPDX enumeration), a one-element
`[{expression}]` tuple for an expression, `{license:{name}}` for anything else.
Emitting every value as an `id` produces a document that looks right and fails
validation — which the first cut did. The id-versus-expression question is
`@effected/spdx`'s (`License.isKnownId`, `isValidExpression`), **never** a local
regex.

### The purl is `pkg:npm/%40scope/name@version`

The scope is the purl **namespace**: the `@` is percent-encoded, the separating
slash stays literal. `encodeURIComponent(name)` — what the predecessor did —
collapses that slash to `%2F` and parses back as a namespace-less name. Pinned
against the package-url spec's own roundtrip vector.

### Nothing reads an ambient clock or environment

`formatCopyright` takes the year as an argument (the predecessor defaulted to
`new Date().getFullYear()`, which made it untestable). `SbomMetadata.timestamp`
is supplied by the caller. `GitHubWorkflowProvenance.serverUrl` is a required
field — upstream `@actions/attest` reads `process.env.GITHUB_SERVER_URL` with
**no default**, so an unset variable writes the literal string `undefined` into
every URL it builds. A test sets that variable to a decoy and asserts the output
does not move.

### `SbomMetadataSource` imports `Package` as a TYPE only

A value import would put `@effected/package-json` — and its `FileSystem` IO
module — on the runtime graph of a package whose SBOM half is otherwise pure.
The reachability suite asserts the resulting edge set exactly, so a stray value
import fails there rather than in a consumer's bundle.

`src/index.ts` does re-export `Package`, `Person` and `Repository` as values,
and that is the one sanctioned place: `SbomMetadataSource.fromPackage` takes a
`Package`, and without the re-export a caller could not name its argument type
without declaring a dependency it does not otherwise have. Same posture as the
entry point re-exporting the signer — the property that matters is that every
pure **module** stays reachable without the heavy graph. **Do not copy the
pattern into `src/`.**

### The signer's error `kind` comes from Sigstore's own error codes

`InternalError` carries `code` (`CA_*`, `TLOG_*`, `TSA_*`, `IDENTITY_TOKEN_*`),
which is what `kindOf` reads. That is why the predecessor's 30-line recursive
cause-chain-to-string flattener (`describeSigstoreError`) has **no successor**:
it existed because the error was about to become a message, and
`cause: Schema.Defect()` keeps the original structurally. An unattributable
failure is `kind: "bundle"` — literally "the bundle did not get built" — rather
than guessed into a step it may not belong to.

### An unwitnessed bundle has no `tlogEntries` key at all

Protobuf JSON omits empty repeated fields, so a bundle signed with
`witnesses: []` carries **no** `tlogEntries` property rather than an empty
array. Reading `.tlogEntries.length` blindly throws on a legitimately
unwitnessed bundle.

### The test doubles do not default the same way, on purpose

`SigstoreSigner.makeTest().sign` **dies**: a fabricated bundle would be a
signature-shaped lie, and that is the strongest case in the kit for the
die-loudly default. A test wanting a real bundle without a network drives the
**real** `DSSEBundleBuilder` through
`SigstoreSigner.layerWith({ signer, witnesses })`.

`IdentityToken.makeTest` **answers** — a fabricated OIDC token is a real answer
to "give me a token", the same judgement that made `LocalExec.makeTest` return
`Option.none()`. The test remains "would a real implementation legitimately
answer this?"

### The reachability walker strips LINE comments first

Ordering is load-bearing, not stylistic. This package's prose contains the token
`` `@sigstore/*` ``, whose `/*` opens a block comment as far as a regex is
concerned; stripping blocks first deleted everything from that word to the end
of the next doc comment — **imports included** — and reported a module that
imports `effect` as importing nothing. It fails in the *safe* direction, which
for a confinement test is the worst direction. Sibling packages that copied this
walker have the opposite order and are safe only by luck.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. Run root-relative
with `--coverage.enabled=false` for subset runs.

**Two vendored oracles, both in `__test__/fixtures/` with a `VENDORED.md` pin.**
Never hand-write an expectation either one can derive:

- `bom-1.6.SNAPSHOT.schema.json` — the published CycloneDX schema. Conformance
  expectations are read **from it** (`required` arrays, `enum` members, property
  names), which is how declining the library costs no conformance confidence.
- `actions-attest-provenance.json` — the predicate `@actions/attest` emits for a
  fixed claim set, transcribed from `actions/toolkit`'s own source. The
  assertion is a deep-equal, so an **extra** field fails as loudly as a missing
  one.

In that fixture's claims, `workflowRef` and `jobWorkflowRef` are deliberately
**different** (a reusable workflow in another repository). Upstream builds the
builder id from one and the workflow path from the other; set equal, a
constructor that confuses them passes everything. A survived mutant found
exactly that — do not collapse them.

Signing is tested with a stub `Signer`/`Witness` through the **real**
`DSSEBundleBuilder`, so the DSSE pre-authentication encoding, envelope assembly
and protobuf serialization are genuinely exercised. The discriminating assertion
is that the stub signer receives `DSSEv1 <len> <type> <len> <body>` — a
hand-rolled fake would sign the JSON.

An opt-in end-to-end run against Sigstore **staging** (via
`layerWith({ fulcioBaseUrl, rekorBaseUrl })`) is the recorded way to catch
upstream protocol drift. It is not a gate and never runs in default CI.

## Build

```bash
pnpm vitest run packages/sbom --coverage.enabled=false
pnpm build --filter @effected/sbom
```

`savvy.build.ts` carries the **narrow** `_base` suppression for Effect's
class-factory heritage types. **Never widen it** — an internal type named on a
`@public` signature is a different symbol and stays unmasked (two public input
interfaces here spell their shared members out twice rather than extend a
private base, for exactly that reason).

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` shaped like a clean gate.
