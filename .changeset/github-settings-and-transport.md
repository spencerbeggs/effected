---
"@effected/github": minor
---

## Breaking Changes

* `AppliedSettings.unverified` is required. Test doubles that build `AppliedSettings` literals must add it.
* `RestExtras.baseUrl` is removed, and `Rest.Params` and `requestDecoded` params forbid `baseUrl`. Point the client at another host through its configuration instead.
* The raw `request`, `requestDecoded`, `paginate` and `paginateStream` refuse `baseUrl`, `url`, `request` and `method` params and any route that resolves off the configured origin. A top-level `url` body field must go in `data`. Cross-origin pagination `Link` headers and continuations fail as rejected instead of truncating.
* `RepositoryPatch` drops the `RequestExtras` transport keys (`headers`, `mediaType`, `baseUrl`).
* `layerFixture` records a repository PATCH as `{ owner, repo, data: {...} }`, not a flat object.
* `DeploymentEnvironment.upsert` takes its configuration in the PUT body only; an `owner` or `repo` in the config now dies instead of silently overriding the target.
* `uploadAsset` uses a private channel: a spread client that overrides `requestDecoded` no longer sees uploads. A hand-built `ReleaseInfo` with an empty, relative or foreign `uploadUrl` now fails as rejected.
* GraphQL variables named `query`, `method` or `url` are now sent as variables, in the POST body; the abort signal now reaches GraphQL calls.
* The test doubles (`makeTest`, `layerTest`, `layerFixture`) refuse the same request options and any route off `api.github.com`, even in GHES-simulating suites. Refused calls are not recorded in `fixtures.requested`.

## Features

* `repositoryPatch(draft, { extra })` sends extras verbatim while the draft stays type-checked, and `applySettings(settings, { unknownKeys: "send" })` forwards undescribed settings keys, reported in `AppliedSettings.unverified` (#1115).
* Interrupting `paginate` aborts the in-flight page.

## Bug Fixes

* Release-asset uploads through `GitHubApp.clientLayer` and `appClientLayer` clients go to the upload host (`uploads.github.com`, or `<ghes>/api/uploads` on GHES) with the current installation token, also after a token rotation. They were sent to the API host, and refused on GHES.
