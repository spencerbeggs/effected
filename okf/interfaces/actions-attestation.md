---
type: Interface
title: actions-attestation
description: OidcTokenIssuer, ActionsIdentityToken and ActionsProvenance — the runner-shaped adapters that close sbom's inverted contracts.
status: stable
kind: api
resource: ../../packages/github-actions/src
tags:
  - architecture
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: e9e837ea5565f6677bab7e7e5b5262123491bac4cb51006f53c69119457ad6bf
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:24.796Z
---

# actions-attestation

## Contract

Three modules: the runner's OIDC token issuer, and two adapters —
`ActionsIdentityToken` and `ActionsProvenance` — that close
[`sbom`](../modules/sbom.md)'s inverted contracts. What lives here is the
runner-shaped half only: reading the token-request variables a workflow
grants itself with `id-token: write`, and handing the resulting identity
and workflow facts to a package that must not know it is running inside an
Action. What an attestation *is* — the statement, the predicate, the
envelope and the signing — stays in `sbom`.

The dependency edge points `github-actions → sbom`, never back: `sbom`
must not depend on the Actions runtime, so the adapters that close its
contracts live here. Taking the edge the other way would drag a required
`@effect/platform-node` peer into every SBOM consumer.

### `OidcTokenIssuer`

Lives here because it reads the runner's token-request variables, which
exist only when a workflow declares `id-token: write`. Its surface is the
token and the token's decoded claims — a typed value, not a nullable
hand-parse at the call site, which is what keeps the provenance path
testable with a synthetic decodable double.

The decode deliberately does **not** verify the JWT signature: the token
comes from the runner's own token-service endpoint over TLS, so the
transport is the trust boundary; the claims populate a provenance
predicate rather than a trust decision; and verifying would require a
key-set fetch, turning a pure decode into a network call. A consumer
needing a *verified* token needs a different operation with a different
name and a different error channel, not an option on this one.

### `ActionsIdentityToken`

The layer closing `sbom`'s identity contract over the issuer, so an action
wanting a signed attestation does not write the adapter itself. `sbom`'s
own static-token layer remains the path for a consumer that already holds
a token.

### `ActionsProvenance`

The projection from the runner's OIDC claims to `sbom`'s SLSA provenance
predicate. The predicate constructor is total and takes camelCase fields;
the only input a workflow holds is the runner's snake_case claims, and the
rename is eleven all-string fields, so transposing the repository id and
the repository-owner id compiles, typechecks and produces a validly
signed attestation asserting the wrong provenance — owning that rename
once is the module's whole point.

The server URL is read as an optional variable with a `github.com`
default, not through the strict context projection, because a missing
server URL has a correct answer (enterprise runners set it;
github.com consumers should never think about it) — the upstream toolkit
reads the same variable with no default and writes the literal string
`undefined` into every URL it builds. The OIDC error passes through
untouched — not caught, not defaulted, not wrapped — because whether
attestation is mandatory or best-effort is the consumer's own policy. The
construct ends at the predicate: statement assembly, signing and upload
stay consumer glue over `sbom`'s signer and `github`'s attestation
surface.

## Stability

`OidcTokenIssuer`, `ActionsIdentityToken` and `ActionsProvenance` are the
contract surface. The claims shape decoded by `OidcTokenIssuer` mirrors
GitHub's own OIDC token, which this package does not own and cannot pin
against a schema of its own.
