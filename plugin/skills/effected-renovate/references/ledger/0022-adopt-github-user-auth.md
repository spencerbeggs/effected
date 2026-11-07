---
id: "0022"
title: "@effected/github: GitHubUserAuth runs the OAuth web flow, and sorts failures into final and temporary"
kind: adopt
shows: none
applies:
  "@effected/github": ">=0.30.0"
detect: ["login/oauth/access_token", "bad_refresh_token", "applications/[^ ]*grant"]
closes: ["spencerbeggs/effected#1216"]
---

Offer this to the user; never apply it unasked. It replaces a hand-rolled OAuth flow on raw `fetch` for a GitHub App acting as a user.

`GitHubUserAuth` has `exchange` (with PKCE), `refresh` and `revokeGrant`. `GitHubUserAuth.layer` takes `clientId`, a `Redacted` `clientSecret` and an injectable `fetch`, and `layerTest` is the double. Tokens are `Redacted`, with expiries as absolute instants. No credential reaches an error message or a kept cause.

Every failure is one of two errors:

- **`GitHubUserAuthFinal`**: GitHub refused. It keeps the `code` and carries a `remedy`.
- **`GitHubUserAuthTemporary`**: `network`, `timeout`, `status` (5xx, 429, 408) or `malformed`. Retry later.

**Branch on `remedy`, not on "final".** `reconnect` means the user's grant is dead (`bad_refresh_token`, `bad_verification_code`), so the user must authorize again and stored tokens can go. `reconfigure` means the app is wrong, and `incorrect_client_credentials` lands here: it is final, but it says nothing about the user's grant.

A handler that wipes tokens on `GitHubUserAuthFinal` alone typechecks and runs, and signs every user out when a client secret is rotated or mistyped. A local flow that keeps `incorrect_client_credentials` temporary for this reason has to move that protection to the `remedy` check when it adopts this. Wipe only on `reconnect`, and alert the operator on `reconfigure`.

After `revokeGrant`, a refresh with the old token answers `bad_refresh_token` as `reconnect`. That is expected. Read the installed `.d.ts` for the exact shapes.
