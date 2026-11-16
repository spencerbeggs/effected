---
type: Decision
title: "@effected/github owns the octokit runtime"
description: Why the octokit client and the sealed-box primitives live in @effected/github rather than being pushed to consumers.
status: stable
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-11-16T17:04:15Z
integrity:
  generated:
    body: 9a11c882da0ec9ec
  verified:
    by: human:spencer
    at: 2026-11-16T16:59:20Z
    content: 87457a836773ed8d
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
  - by: human:spencer
    at: 2026-11-16T16:59:20Z
---

# @effected/github owns the octokit runtime

## Context

A predecessor put octokit, an OAuth arm, an SBOM library and a signing stack
behind one entry point. One consumer responded by shipping a hand-written
bundler ignore list for XML libraries it never invoked, evidence that the
package's dependency shape was leaking cost onto consumers that did not want
most of it. Interpreting GitHub's REST and GraphQL API is nonetheless a
concern every consumer of the kit needs, typed, at least once.

## Decision

`@effected/github` carries the octokit runtime — `@octokit/core`,
`@octokit/plugin-paginate-rest`, `@octokit/types` — plus the libsodium sealed
box GitHub's secrets API demands, built from in-house copies of audited `@noble`
code with no third-party crypto dependency (see [the primitives are
copied](sealed-box-primitives-copied.md)). A sealed box is `crypto_box` under an
ephemeral keypair with a nonce derived as `blake2b(ephemeral_pk ‖
recipient_pk, 24)` (`packages/github/src/internal/crypto.ts`); Node ships
neither X25519 `crypto_box` nor blake2b, so `node:crypto` was never an
alternative. The kit's own `@effected/jwt` signs the App JWT over
WebCrypto, with no runtime dependencies.

This makes `@effected/github` integrated tier by the kit's dependency
policy: it owns a heavy runtime rather than merely consuming one. That is
accepted rather than fought, because the alternative — pushing octokit
itself, or a hand-rolled REST client, onto every consumer — is exactly the
duplication a kit exists to end.

The tier does not move when the sealed-box primitives are added on top of the octokit
edge, because the package is already integrated and nothing depends on it
but `@effected/github-actions`, itself integrated. A third non-octokit
runtime dependency added here must be treated as a fresh decision rather
than a free ride on this one.

## Alternatives rejected

- **Push octokit to every consumer directly.** This is what a predecessor's
  design effectively forced by exposing an untyped operation-string surface;
  every consumer re-derived its own typing and its own client wiring.
- **`@octokit/rest`, for convenience.** It bundles a request-log plugin this
  package immediately silences and duplicates `@octokit/types` at
  megabyte cost, for zero typing benefit over the bare core client.
- **`@octokit/auth-app`, for App authentication.** It re-exports an OAuth
  user-auth factory, making hundreds of kilobytes of OAuth app, user and
  device-flow machinery reachable from a package that only ever mints
  installation tokens.
- **A full libsodium build**, for the sealed box. Rejected as unnecessary
  weight for the single algorithm actually needed; the copied `@noble`
  primitives replaced the `tweetnacl` + `blakejs` pair that first stood in
  for it.

## Consequences

`@effected/github` must maintain the bundle-reachability invariant that
keeps the JWT signer and the sealed-box primitives confined to the modules that
actually need them (`GitHubApp.ts`, `RepositorySecret.ts`), so that a
token-only REST consumer never pays for either — see
[bundle reachability](../modules/github.md#bundle-reachability). A
consumer that wants none of octokit at all — only the pure permission
comparator, or the extracted issue-reference grammar — reaches for the
pure surfaces or for [`@effected/github-references`](../modules/github-references.md)
instead.
