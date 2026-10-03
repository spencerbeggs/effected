# Statements, provenance, identity tokens and signing

Load when: building an in-toto statement or SLSA provenance predicate,
wiring the OIDC identity-token contract inside or outside Actions, signing
into a Sigstore bundle, or uploading the result to GitHub.

## Build the statement and predicate — `InTotoStatement`, `SlsaProvenance`

`InTotoSubject.forSha256` needs a validated digest —
`Sha256Digest.parse`/`parseResult` strip an optional `sha256:` prefix and
lowercase the hex:

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
hand mapping it replaces is eleven same-typed string renames where
transposing two similarly-named claim fields compiles clean and signs a
wrong attestation; `capture` exists to make that unwritable. The typed
`OidcTokenError` passes through — catch-and-skip vs mandatory attestation
is the caller's policy, not the kit's.

`SlsaProvenance.forGitHubWorkflow` is **total, a pure projection** —
upstream tooling reads the server-URL environment variable with no default
and writes the literal string `"undefined"` into every URL it builds when
it's unset; `GitHubWorkflowProvenance.serverUrl` is a **required field**
here instead. `GitHubWorkflowProvenance` is a **plain input record, not a
contract service** — there is nothing to swap and no IO to invert.

## `IdentityToken` — the program's third inverted contract

Signing needs a workload identity token. Issuing one needs the Actions
runtime (a platform HTTP client reading `ACTIONS_ID_TOKEN_REQUEST_URL`),
which lives in `@effected/github-actions` — an integrated package with a
**required** `@effect/platform-node` peer. `@effected/sbom` must not take
that edge, so the dependency is inverted, joining `@effected/npm`'s
`CatalogResolver` and `@effected/commands`' `LocalExec`:

```ts
export interface IdentityTokenShape {
  readonly token: (audience: string) => Effect.Effect<Redacted.Redacted<string>, IdentityTokenError>;
}
```

`sbom` declares the contract; `github-actions` ships `OidcTokenIssuer`,
whose runner half reads the request token/URL pair and decodes claims. **The
adapter ships — do not hand-roll it:**

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

**The audience constant stays in `sbom`, not the caller.** Sigstore's
required audience is Sigstore's requirement, not the caller's knowledge,
which is why `sign` takes only a statement and asks the contract for a
token itself rather than accepting one as a parameter.

## Sign — `SigstoreSigner` → `SigstoreBundle`

```ts
import { SigstoreSigner } from "@effected/sbom";
import { Effect, Layer } from "effect";

const bundle = yield* Effect.gen(function* () {
  const signer = yield* SigstoreSigner;
  return yield* signer.sign(statement);
}).pipe(Effect.provide(SigstoreSigner.layer.pipe(Layer.provide(ActionsIdentityToken.layer), Layer.provide(OidcTokenIssuer.layer))));
```

`SigstoreSigner.layer` signs against the public-good Fulcio/Rekor
instances; `SigstoreSigner.layerWith({ fulcioBaseUrl, rekorBaseUrl, signer,
witnesses })` is one entry point for both the Sigstore staging e2e and the
test seam.

**An unwitnessed bundle has NO `tlogEntries` key at all.** Protobuf JSON
omits empty repeated fields, so signing with an empty witness list produces
verification material with no `tlogEntries` property — not an empty array.
Reading a `.tlogEntries.length` blindly throws on a legitimately
unwitnessed bundle; check for the key's presence first.

**The signer's error `kind` comes from Sigstore's own error codes** — a
certificate-authority failure, a transparency/timestamp-log failure, and an
identity-token failure each map to their own `kind`, and `cause` keeps the
original failure structurally rather than flattening it into a message. An
unattributable failure is `kind: "bundle"` — "the bundle did not get
built" — rather than guessed into a step it may not belong to.

## Upload — `@effected/github`'s `Attestation.upload`

```ts
import { Attestation, Repo } from "@effected/github";
import { Effect } from "effect";

const record = yield* Attestation.upload(bundle).pipe(Effect.provide(Repo.layer({ owner, repo })));
```

`upload` types `bundle` as `unknown` — the Sigstore bundle crosses this
seam as a **structural JSON value** (`{ mediaType, verificationMaterial,
dsseEnvelope }`), never as `sbom`'s own class. **There is no edge between
`sbom` and `github` in either direction**; `github` types the parameter
structurally and the consumer wires the two together. It's the same
pattern `github` already uses for one other cross-package digest type — a
small deliberate duplication beats dragging a package across a seam.

## Testing this pipeline

- **Two vendored oracles**, both pinned with a provenance note: the
  published CycloneDX 1.6 JSON schema (used to derive `required`/`enum`
  expectations rather than hand-write them), and a fixed claim set's
  predicate output transcribed from the upstream Actions toolkit source (a
  deep-equal assertion, so an extra field fails as loudly as a missing
  one).
- **Two fields that look interchangeable in a SLSA fixture are
  deliberately different** — a reusable workflow's own ref and the calling
  job's workflow ref build two different parts of the provenance (a
  builder id from one, a workflow path from the other). Setting them equal
  in a fixture lets a constructor that confuses them pass everything —
  don't collapse them in a new fixture.
- **`SigstoreSigner.makeTest().sign` dies unstubbed** — a fabricated bundle
  would be a signature-shaped lie, the strongest case in the kit for the
  die-loudly default. Contrast **`IdentityToken.makeTest`, which
  answers** — a fabricated OIDC token is a real answer to "give me a
  token," the same judgment that makes `LocalExec.makeTest` return
  `Option.none()` rather than die.
- **The stub-`Signer`-through-the-real-builder recipe**: supply a stub
  signer/witness by interface and let the real DSSE bundle builder run, so
  pre-authentication encoding, envelope assembly and protobuf
  serialization are genuinely exercised. The discriminating assertion is
  that the stub signer receives the pre-authentication encoding, not the
  raw JSON — a hand-rolled fake would sign the wrong bytes.
- **An opt-in Sigstore staging e2e** catches upstream protocol drift; it is
  not a gate and never runs in default CI.
