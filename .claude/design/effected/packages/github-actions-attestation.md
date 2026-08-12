---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 95
related:
  - github-actions.md
  - github-actions-runtime.md
  - sbom.md
  - github.md
---

# @effected/github-actions — OIDC and the attestation seam

## Overview

The attestation seam is three modules: the runner's OIDC token issuer, and the two adapters — `ActionsIdentityToken` and `ActionsProvenance` — that close [`@effected/sbom`](sbom.md)'s inverted contracts. What lives here is the runner-shaped half only: reading the token-request variables a workflow grants itself with `id-token: write`, and handing the resulting identity and workflow facts to a package that must not know it is running inside an Action. What an attestation *is* — the statement, the predicate, the envelope and the signing — stays in `sbom`. Package-wide framing is in [github-actions.md](github-actions.md).

The rule they exist to serve: **`@effected/sbom` must not depend on the Actions runtime, so the adapters that close its contracts live here.** The dependency edge points `github-actions → sbom`, never back — the [inverted-contract pattern](../effect-standards.md#dependency-policy) already used for `@effected/npm`'s resolvers and `@effected/commands`' local-exec contract. Taking the edge the other way would drag a required platform peer into every SBOM consumer.

## `OidcTokenIssuer`

It lives here rather than in `sbom` because it reads the runner's token-request variables, which exist only when a workflow declares `id-token: write`. Its surface is the token and the token's **decoded claims**.

**Decoded claims are a typed value on the surface, not a nullable hand-parse at the call site**, and that is the fix for a structurally untestable provenance path: a predecessor's test double returned a synthetic non-JWT, so a consumer's own claim decode yielded null, so the provenance branch was **never reached** — with four separate apologetic comments in one consumer repo about it. With claims on the issuer's surface a test double returns real decodable claims and the path becomes reachable.

**The decode deliberately does NOT verify the JWT signature.** Three reasons, recorded so a future agent does not "fix" it:

1. The token comes from the runner's **own token-service endpoint over TLS** — the transport is the trust boundary, and the process asking for the token is the process that received it.
2. The claims populate a **provenance predicate**, not a trust decision. Nothing branches on them for authorization; they are recorded as attested facts about the workflow that ran.
3. Verifying would require a **key-set fetch**, turning a pure decode into a network call — non-pure, untestable without a fixture server, and dependent on GitHub's key endpoint being reachable at attestation time.

If a consumer ever needs a *verified* token, that is a different operation with a different name and a different error channel, not an option on this one.

## `ActionsIdentityToken`

The layer closing `sbom`'s identity contract over the issuer. Without it, every action wanting a signed attestation wrote the adapter itself — from a contract in one package against a service in another — which is exactly the work an inverted contract is supposed to have already done. `sbom`'s static-token layer remains the path for a consumer that already holds a token.

## `ActionsProvenance`

The projection from the runner's OIDC claims to `sbom`'s SLSA provenance predicate. The predicate constructor is total and does the real work, but it takes camelCase fields, and the only input anyone inside a workflow holds is the runner's snake_case claims. **The rename is eleven all-string fields**, so transposing the repository id and the repository-owner id compiles, typechecks and produces a **validly signed attestation asserting the wrong provenance**. Owning that rename once is the whole point of the module.

Three decisions inside it are worth keeping:

- **The server URL is read as an optional variable with a github.com default**, not through the strict context projection. The projection fails typed when a variable is absent, and a missing server URL is *not* a failure — it has a correct answer. Enterprise runners set it; github.com consumers should never think about it. The upstream toolkit reads the same variable with no default and writes the literal string `undefined` into every URL it builds, which is precisely the hazard `sbom` guards by making the field required.
- **The OIDC error passes through untouched** — not caught, not defaulted, not wrapped. Whether attestation is mandatory or best-effort is the *consumer's* policy: an action that must not publish unattested lets it propagate, one that publishes anyway catches it at its own boundary. An unavailable token almost always means the workflow forgot `permissions: id-token: write`.
- **The construct ends at the predicate.** Statement assembly, signing and upload stay consumer glue over `sbom`'s signer and [`@effected/github`](github.md)'s attestation surface — the same line [the sbom design draws](sbom.md#the-attestation-seam-no-edge-either-way).
