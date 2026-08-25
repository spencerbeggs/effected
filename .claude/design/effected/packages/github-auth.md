---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - github.md
  - github-rest.md
  - github-errors.md
  - github-actions.md
  - github-actions-runtime.md
---

# @effected/github — App authentication

## Overview

App authentication is the third way to get a client: an RS256 App JWT signed by a zero-dependency leaf, installation tokens minted through the same typed route table as every other call, and a lifecycle that enriches, expires, re-mints and revokes them. Bot identity and the signoff trailer it renders come with it, because they are projections of the same token.

It is split out because it owns the one dependency a token-only consumer must not link — the JWT signer — and that reachability constraint, not style, decides which module carries the App-authenticated client layer. It also carries the seam [`@effected/github-actions`](github-actions-runtime.md#the-app-token-bridge) builds its phase-oriented token bridge on; what belongs here is the token and its lifecycle, while the bridge that persists one across a phase boundary stays Actions-side. Package-wide framing — including [why the OAuth-carrying auth package was dropped](github.md#tier-and-dependencies) — is in [github.md](github.md).

## Where the App client layer lives

The house convention is a `layer` static on the service class, with variants as suffixed statics. That convention and the [reachability invariant](github.md#bundle-reachability) collide exactly once: the client has three constructors, one of which needs the JWT signer, and **statics on one class must share one module**. Putting the App-authenticated client layer on the client class would make every token-only consumer's import reach the signer.

**Resolution: the module that owns the heavy edge owns the layer.** The App module exports both its own service layer and a **client** layer — a `layer`-family static producing *another service's* layer. The kit has this precedent already, since `@effected/workspaces` ships the layer implementing [`@effected/commands`](commands.md#the-workspaces-edge-inverts)' contract. The naming rule that generalizes both: **a cross-service layer static belongs to the module that owns the dependency the layer needs, not to the module that declares the service** — because a static cannot cross a module boundary and a heavy dependency must not.

The alternative spellings each cost something: a suffixed name on the client class reads as "a layer of clients", a fully-qualified name matches the workspaces precedent exactly but is a mouthful, and re-exporting a bound const from the entry point reintroduces exactly the cross-module reach the split exists to prevent.

## The token lifecycle

The service mints an installation token, mints one **scoped** to a `Scope` with best-effort revocation on close, revokes explicitly, enriches with the App's identity and lists installations. The token itself is a schema class with a **JSON-encodable encoded form** — the redacted value encodes to the raw string and the expiry to an ISO string — which is precisely what lets [`@effected/github-actions`](github-actions-runtime.md#the-app-token-bridge) persist it across a phase boundary.

Five deliberate shapes:

- **Expiry is enforced, not merely persisted.** A predecessor stored the expiry and read it nowhere, so a long-running phase outliving the roughly one-hour token simply started failing with an unauthorized status and no explanation. Here the token can answer whether it is expired, the App client layer re-mints inside a small skew window and an unauthorized response on a minted token retries **once** after a forced re-mint. This is the one place the client's retry policy is not sufficient, because the fix is not "wait" but "get a new token".
- **Bot identity moves off the service shape.** It was a synchronous member on a service, which forces every mock to a full implementation. It becomes a **pure class** with statics — one for an App's identity, one for the well-known Actions bot — plus an instance projection off the token. It is **not** wrapped in `Effect.succeed`; that is the named anti-pattern.
- **Installation discovery is environment-free and not hand-paged.** A predecessor matched installations against a repository slug read from the environment — env-coupled auth inside the auth layer. Here it matches against [the repo coordinate](github.md#the-repo-coordinate) when one is provided, or an explicit owner, and it walks the installations endpoint through the client's real paginator instead of a link-header regex.
- **Identity keeps its documented quirk.** The bot-user lookup rejects an App JWT, so it bears the installation token when one is supplied and otherwise runs unauthenticated at GitHub's anonymous rate limit. That is GitHub's behaviour, not a defect; it stays, documented, with the unauthenticated path surfacing as an identity-kind failure rather than a silent degrade.
- **Revocation stays best-effort and keeps its exact authorization scheme**, which GitHub is specific about.

## Signoff is part of identity

Bot identity renders the DCO trailer, from the type that owns the data. Commits created through the Git Data API bypass the porcelain's own signoff, so **no tooling adds the trailer**, and a hand-built one that is subtly wrong — casing, spacing, brackets — fails late as a red compliance check on someone else's pull request.

Whether a missing identity falls back to the well-known Actions bot stays the **caller's** policy: that is a decision about attribution, not about formatting.

## The seam the Actions runtime needs

The phase-oriented bridge — provision in `pre`, persist, mask, dispose in `post` — **stays out of this package**; it is Actions-shaped by construction. What this package owes it is a surface it can build on without reaching inside, and a **member-usage table documented per exported member**, so a partial mock is built from the table rather than from a stack trace.

| The Actions runtime needs | This package provides |
| --- | --- |
| mint a token in `pre` | the token member |
| mint with automatic revocation | the scoped token member |
| enrich with bot identity | the identity member |
| persist across the process boundary | the token's JSON-encodable encoded form |
| rebuild a client in `main` from a persisted token | the token client layer |
| revoke in `post` | the revoke member |
| render a committer identity | the pure identity class |

Two things this package deliberately does **not** do, both because they are the caller's concern: **masking** (a runner output command) and **persistence** (the runner's state file stores plaintext by GitHub's protocol, which a redacted value cannot survive by design).

**The two packages' option shapes are not a shared field set**, and reading them as one is a live trap. This package's token request carries only an installation id or an owner beside the credentials — **no scope field, because this package never verifies permissions itself**. Scope verification lives one level up, in the Actions bridge, whose options require the credentials explicitly and name the scope-check field for what it *requires*; the word "permissions" is reserved for what the token reports GitHub actually **granted**.
