---
"@effected/github": minor
---

## Bug Fixes

### Security: request-option injection

`updateSettings` and `applySettings` spread an open settings map beside octokit's request options, so a key such as `baseUrl`, `headers` or `request` could send the authenticated PATCH to another host with the token attached. Settings now travel as octokit's `data` body. `repositoryPatch` throws a `RangeError` for a reserved name or `__proto__`, and `applySettings` reports one in `ignored`.

### Security: token confined to the configured base

The configured token is only sent to the configured base. Routes that resolve elsewhere, absolute-URL routes and pagination `Link` headers pointing to another origin are refused.

### Security: GHES upload host

On GitHub Enterprise Server the release-asset upload host is derived from the configured base, so the token is no longer sent to `uploads.github.com`.

### Security: credential-free error causes

`GitHubError` and `GitHubGraphQLError` keep a scrubbed copy of the cause: no request body, options, `set-cookie`, response data or GraphQL data and errors. `instanceof` still holds but object identity does not. `@effected/github` now depends on `@effected/crypto`.
