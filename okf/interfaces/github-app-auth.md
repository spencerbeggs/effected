---
type: Interface
title: "@effected/github App authentication"
description: The App JWT, installation-token lifecycle, and the seam the GitHub Actions runtime bridges on.
status: stable
kind: api
resource: ../../packages/github/src/GitHubApp.ts
tags: [bundle, security]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 6c7a6bc94313aeb951a2966f407c75e82b477932643878e71e5eb277057b633a
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:25.629Z
---

# @effected/github App authentication

App authentication is the third way to get a client: an RS256 App JWT signed
by a zero-dependency leaf, installation tokens minted through the same typed
route table as every other call, and a lifecycle that enriches, expires,
re-mints and revokes them. Bot identity and the DCO signoff trailer it
renders come with it, because they are projections of the same token.
Package-wide framing — including why the OAuth-carrying auth package was
dropped — is in [the `github` module](../modules/github.md).

It is split into its own module because it owns the one dependency a
token-only consumer must not link: the JWT signer. That reachability
constraint, not style, decides which module carries the App-authenticated
client layer. It also carries the seam `@effected/github-actions` builds its
phase-oriented token bridge on: what belongs here is the token and its
lifecycle, while the bridge that persists one across a phase boundary stays
Actions-side.

## Where the App client layer lives

The house convention is a `layer` static on the service class, with variants
as suffixed statics. That convention and the reachability invariant collide
exactly once: the client has three constructors, one of which needs the JWT
signer, and statics on one class must share one module. Putting the
App-authenticated client layer on the client class would make every
token-only consumer's import reach the signer.

Resolution: the module that owns the heavy edge owns the layer.
`packages/github/src/GitHubApp.ts` exports both its own service layer and a
client layer — a `layer`-family static producing another service's layer.
The naming rule that generalizes: a cross-service layer static belongs to
the module that owns the dependency the layer needs, not to the module that
declares the service, because a static cannot cross a module boundary and a
heavy dependency must not.

## The token lifecycle

The service mints an installation token, mints one scoped to an `Effect`
`Scope` with best-effort revocation on close, revokes explicitly, enriches
with the App's identity, and lists installations. The token itself is a
schema class with a JSON-encodable encoded form — the redacted value
encodes to the raw string and the expiry to an ISO string — which is
precisely what lets `@effected/github-actions` persist it across a phase
boundary.

Five deliberate shapes:

- **Expiry is enforced, not merely persisted.** An expiry that is stored and
  read nowhere means a long-running phase outliving the roughly one-hour
  token simply starts failing with an unauthorized status and no
  explanation. The token can answer whether it is expired, the App client
  layer re-mints inside a small skew window, and an unauthorized response on
  a minted token retries once after a forced re-mint — the one place the
  client's general retry policy is not sufficient, because the fix is not
  "wait" but "get a new token".
- **Bot identity is not on the service shape.** A synchronous member on a
  service forces every mock to a full implementation, so it is a pure class
  with statics instead — one for an App's identity, one for the well-known
  Actions bot — plus an instance projection off the token. It is not
  wrapped in `Effect.succeed`.
- **Installation discovery is environment-free and not hand-paged.** It
  matches installations against the repo coordinate when one is provided or
  an explicit owner — never a repository slug read from the environment,
  which would be env-coupled auth inside the auth layer — and it walks the
  installations endpoint through the client's real paginator instead of a
  link-header regex.
- **Identity keeps its documented quirk.** The bot-user lookup rejects an
  App JWT, so it bears the installation token when one is supplied and
  otherwise runs unauthenticated at GitHub's anonymous rate limit. That is
  GitHub's behaviour, not a defect, and it surfaces as an identity-kind
  failure rather than a silent degrade.
- **Revocation stays best-effort and keeps its exact authorization scheme**,
  which GitHub is specific about.

## Signoff is part of identity

Bot identity renders the DCO trailer, from the type that owns the data.
Commits created through the Git Data API bypass the porcelain's own signoff,
so no tooling adds the trailer, and a hand-built one that is subtly wrong —
casing, spacing, brackets — fails late as a red compliance check on someone
else's pull request. Whether a missing identity falls back to the
well-known Actions bot stays the caller's policy: that is a decision about
attribution, not about formatting.

## The seam the Actions runtime needs

The phase-oriented bridge — provision in `pre`, persist, mask, dispose in
`post` — stays out of this package; it is Actions-shaped by construction.
What this package owes it is a surface it can build on without reaching
inside, documented per exported member:

| The Actions runtime needs | This package provides |
| --- | --- |
| mint a token in `pre` | the token member |
| mint with automatic revocation | the scoped token member |
| enrich with bot identity | the identity member |
| persist across the process boundary | the token's JSON-encodable encoded form |
| rebuild a client in `main` from a persisted token | the token client layer |
| revoke in `post` | the revoke member |
| render a committer identity | the pure identity class |

Two things this package deliberately does not do, both because they are the
caller's concern: masking (a runner output command) and persistence (the
runner's state file stores plaintext by GitHub's protocol, which a redacted
value cannot survive by design).

**The two packages' option shapes are not a shared field set, and reading
them as one is a live trap.** This package's token request carries only an
installation id or an owner beside the credentials — no scope field, because
this package never verifies permissions itself. Scope verification lives one
level up, in the Actions bridge, whose options require the credentials
explicitly and name the scope-check field for what it *requires*; the word
"permissions" is reserved for what the token reports GitHub actually
*granted*.
