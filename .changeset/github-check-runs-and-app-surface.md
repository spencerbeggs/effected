---
"@effected/github": minor
---

## Features

### A full check-run read model

`CheckRunRef` now carries what GitHub reports about a run. Every new field is optional, so a double built with `CheckRunRef.make({ id, name, url, status })` stays valid.

* `headSha`, `nodeId`, `startedAt`, `completedAt`, `detailsUrl` and `checkSuiteId`.
* `conclusion`, typed by the new `ReportedCheckConclusion`: the write set plus `stale`, which only GitHub sets.
* `output`, a new `ReportedCheckRunOutput` with `title`, `summary` and `annotationsCount`. It never carries the long-form text.
* `apiUrl` (the REST URL) and `htmlUrl` (the web URL with GitHub's `null` kept). `url` still means the web URL, `""` when GitHub sent none.

### Returning variants and a commit listing on `CheckRun`

* `updateRef` and `completeRef` send the same PATCH as `update` and `complete` and answer the decoded `CheckRunRef`. `update` and `complete` still discard the response, so doubles that stub them with `Effect.void` keep compiling.
* `list(ref, { checkName?, appId?, status?, filter?, page? })` reads the check runs on a commit, filtered on GitHub's side and paginated.

### `AuthenticatedApp`

A new resource service for the app-level routes, provided over `GitHubApp.appClientLayer`:

* `get()` reads `GET /app` into `AppInfo` (`id`, `slug`, `name`, `nodeId`, `clientId`, `htmlUrl`).
* `deliveries({ status?, page? })` is a lazy `Stream<DeliveryAttempt>` over the webhook delivery log, so `Stream.takeWhile` stops it without fetching further pages.
* `delivery(id)`, `redeliver(id)` and `uninstall(installationId)`.

Delivery, installation and repository ids decode as safe integers. An id past 2^53 fails the read with a `decode` error instead of being rounded to a different id.

### `GitHubApp.botUser`

`botUser({ slug, installationToken? })` reads the app's bot user into `BotUser` (`id`, `login`). Where `identity` leaves out the id when the lookup fails, `botUser` fails with `kind: "identity"`.

## Breaking Changes

* `CheckRunRef.status` is now the `CheckRunStatus` literal set, not `string`. A double that builds a ref from an arbitrary string no longer type-checks.
* A response whose status or conclusion falls outside the documented sets now fails `create`, `get` and `findByExternalId` with a `decode` `GitHubError` instead of passing an unknown string through.
