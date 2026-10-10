---
"@effected/github": minor
---

## Features

### App authentication

* `GitHubApp.appClientLayer` builds a client authenticated as the App itself, for endpoints that take the App JWT rather than an installation token.
* `GitHubApp.cachedToken` and `GitHubApp.cachedClientLayer` cache installation tokens, backed by the new `InstallationTokenStore` seam.
* `Installation` gains `suspendedAt`, `accountType`, `accountId` and `updatedAt`. They are read leniently, so a response without them still decodes.

### Actions OIDC verification

`ActionsOidc.verify` checks a GitHub Actions OIDC token against GitHub's published keys and returns the decoded `ActionsOidcClaims`.

### Errors and fixtures

* `GitHubError.fromResponse` classifies an HTTP response into a `GitHubError`. It requires `nowMillis`.
* `GitHubFixtures.failure` scripts a failing call in tests.

### Check runs and workflow runs

* `CheckRun.create`, `update` and `complete` take richer options, and `CheckRun.findByExternalId` finds a check run by its external id.
* `WorkflowDispatch.cancelRun` cancels a workflow run.

## Breaking Changes

* `CheckRunShape` changed: the `update` output is optional, `complete` takes options, and `findByExternalId` is new. `WorkflowDispatchShape` gained `cancelRun`. Hand-written implementations of these shapes must be updated; calls through `CheckRun` and `WorkflowDispatch` are source-compatible.
* RSA App private keys under 2048 bits are refused with a `GitHubAppError` of `kind` `"jwt"`.
* `getFile` fails with a typed `decode` error when the content is not standard padded base64, and a check-run response missing required fields fails as a typed `decode` error.

## Bug Fixes

* PKCS#1 App keys now work on every runtime, and keys with escaped `\n` line breaks are accepted.
* Concurrent credential rotation now rotates once instead of once per caller.

## Build System

* The App JWT is now signed by `@effected/jwt`, and no `Buffer` is used on the request path, so `nodejs_compat` is no longer needed on Cloudflare Workers.
