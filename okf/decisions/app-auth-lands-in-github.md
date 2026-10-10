---
type: Decision
title: App auth, OIDC verify and the token store land in @effected/github
description: GitHub App authentication, Actions OIDC verification and the installation token store go in @effected/github on a regular dependency on @effected/jwt, with no @effected/github-app package.
status: draft
tags:
  - architecture
  - github
  - bundle
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-10-09T00:00:00Z
  - id: core-crypto
    resource: ../../.repos/effect/packages/effect/src/Crypto.ts
    title: "Core Crypto: random bytes, digests and ids, and no sign, verify or importKey"
  - id: eventlog-session-auth
    resource: ../../.repos/effect/packages/effect/src/eventlog/EventLogSessionAuth.ts
    title: "Core's precedent for reading globalThis.crypto.subtle and failing when it is absent"
generated:
  by: "okfit/claude-code"
  at: 2026-10-10T00:53:24Z
  body_sha256: bd31b82a5e714c9e2d71728dd13282f13baf2e73d7f6ca84a7f83951b8f64cc1
---

# App auth, OIDC verify and the token store land in @effected/github

## Context

The silk-app dogfood loop (savvy-web/silk-app, a Cloudflare Workers GitHub App) needs App JWT signing, installation token minting and caching, and verification of GitHub Actions OIDC tokens. The maintainer's constraints on the package split were: a re-export path for existing `GitHubApp` consumers for one minor, no crypto cost for consumers that only use the REST client, and an implementation that runs on workerd (WebCrypto, no `node:crypto`). The work covers issues 768 (the two JWT halves), 970 (the token store), 975 (additive `Installation` fields) and 827 (`GitHubError.fromResponse`). The signing and verifying primitives live in the [`@effected/jwt` module](../modules/jwt.md); the question here is where the GitHub-specific halves live.

## Decision

App auth (`GitHubApp`), OIDC verification (`ActionsOidc.verify` and `ActionsOidcClaims`) and the installation token store (`InstallationTokenStore`) go in [`@effected/github`](../modules/github.md). There is no `@effected/github-app` package. `github` takes a regular dependency on `@effected/jwt`, and its reachability table gains `ActionsOidc` beside `GitHubApp`. The token-only client must not reach `@effected/jwt`, and `InstallationTokenStore` must not reach it either, so a REST-only consumer pays no crypto cost. Every existing `github` export stays source-compatible, and `Installation.account` stays a login string so the new fields are additive.

## Alternatives rejected

- **A `github-app` package.** Its one-minor re-export from `github` is a `github` to `github-app` cycle, and static root re-exports to a separate package broke unbundled consumers before: the optional-peers change in issue 250 was reverted for that reason; see [the `./ui` subpath with optional peers decision](ui-is-a-subpath-with-optional-peers.md).
- **JWT inside `github`.** It would keep issue 768's two JWT halves, signing and verifying, without a shared vocabulary, and would leave `github` owning primitives that nothing GitHub-specific constrains.

## Consequences

`github` gains a regular dependency on a boundary-tier package with no runtime dependencies of its own, and a reachability test that pins which modules may import it. The signing primitives are reusable by any consumer through `@effected/jwt` without the GitHub surface.
