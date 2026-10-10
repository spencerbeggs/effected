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
  at: 2026-10-10T00:53:24Z
  body_sha256: e0a1e9b95386c11684f3f3d884b5d0cbfb9bca5ef53d79140e7b110e415b609c
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:25.629Z
---

# @effected/github App authentication

App authentication is the third way to get a client: an RS256 App JWT signed
by `@effected/jwt` over WebCrypto, installation tokens minted through the same typed
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
exactly once: the client has five constructors, three of which need the JWT
signer (installation, app-itself and cached-token), and statics on one class
must share one module. Putting the
App-authenticated client layer on the client class would make every
token-only consumer's import reach the signer.

Resolution: the module that owns the heavy edge owns the layer.
`packages/github/src/GitHubApp.ts` exports both its own service layer and a
client layer — a `layer`-family static producing another service's layer.
The naming rule that generalizes: a cross-service layer static belongs to
the module that owns the dependency the layer needs, not to the module that
declares the service, because a static cannot cross a module boundary and a
heavy dependency must not.

## The private key

`AppCredentials.privateKey` is a `Redacted` PEM, read only at the import call
inside `@effected/jwt`. PKCS#1 (`BEGIN RSA PRIVATE KEY`, what github.com
hands out) and PKCS#8 are both accepted on every runtime with WebCrypto,
Cloudflare workerd included: a PKCS#1 key is wrapped to PKCS#8 in-process, so
no `openssl` conversion step exists any more. A key whose newlines arrive
escaped as the two characters backslash and `n` — the one-line form an
environment variable carries — is accepted, matching the signer it replaced.
The key must be RSA of at least 2048 bits; anything else is a `jwt`-kind
failure carrying the `JwtError` as its cause.

## Three client layers

- **As an installation** (`GitHubApp.clientLayer`): mints on build, so a
  misconfigured app fails construction; re-mints a minute before expiry and
  revokes the token it replaces; revokes the last on release.
- **As the app itself** (`GitHubApp.appClientLayer`): an App JWT, signed
  locally (building the layer makes no request), lives nine minutes and is
  re-signed a minute before expiry; nothing to revoke. It authenticates only
  `/app`, `/app/*` and the three JWT-only installation lookups
  (`/repos/{owner}/{repo}/installation`, `/orgs/{org}/installation`,
  `/users/{username}/installation`); installation-scoped routes answer 401.
  The motivating consumer is a webhook redelivery sweep.
- **From a cached token** (`GitHubApp.cachedClientLayer`, over
  `GitHubApp.cachedToken`): see below.

Both rotating layers share one engine, and concurrent requests that find the
credential spent rotate **once**: a one-permit lock with a re-check after
acquiring, so N waiters cause one mint and no fiber's in-use token is
revoked by another's rotation.

## Tokens across request scopes

A program that authenticates per request scope — a Cloudflare Worker
handling a webhook — would mint a fresh installation token every time.
`GitHubApp.cachedToken(request)` reads an `InstallationTokenStore` first:

- The store is a `Context.Service` seam keyed by **installation id, never
  token text**, holding the token's JSON encoding. That encoding contains the
  raw token, so encryption at rest is the store's job. `layerMemory` keeps it
  in process; a Worker backs it with KV, a Durable Object or D1. The store's
  module imports nothing but `effect`, so an implementation never links the
  JWT signer.
- `installationId` is required: discovery per request would defeat the
  cache. A stored value that will not decode, or a token within `margin`
  (five minutes by default) of expiry, is a miss; the token is minted and
  written back with a TTL of its expiry minus `margin`. A token issued with
  less than `margin` to live is returned once and not stored.
- A store that fails or dies never fails the call (a miss on `get`, ignored
  on `set`); only interruption propagates.
- **A cached token is never revoked**, not even on release — another scope
  or isolate may be using it. Two concurrent misses may both mint; the store
  may span isolates, so the kit cannot lock it, and that is accepted.
- `cachedClientLayer`'s transport options configure the client, not the
  mint: the edge's `GitHubApp` layer mints, so on GHES it must be built with
  the same `baseUrl`.

## Verifying Actions OIDC tokens

`ActionsOidc.verify(token, { audience })` is the inbound half: a workflow
proving to your service which repository, workflow and run it is. It
verifies against GitHub's JWKS for the github.com Actions issuer through
`@effected/jwt`'s `JwksResolver` (keyed on the configured issuer, never the
token's `iss`), with a **mandatory, non-empty audience** because one JWKS
signs tokens for every relying party, and decodes camelCase claims with
numeric ids. Authorize on immutable ids (`repositoryId`,
`repositoryOwnerId`) plus `jobWorkflowRef`, never on a repository name,
which can be registered again after deletion. GHE.com enterprise issuers and
GHES issuers are refused. The module reaches `@effected/jwt` and not
octokit.

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
