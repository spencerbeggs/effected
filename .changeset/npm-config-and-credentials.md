---
"@effected/npm": minor
---

## Breaking Changes

* `NpmRegistry` now follows redirects (at most 10), and `PackageTarball` follows them too; a client that did not follow used to fail a 302.
* Credentials are only sent over https, or over http when the registry for that host is configured as http. Inline key and cert values and URL userinfo count as secrets.

## Features

* `NpmConfig` resolves registry reads the way npm does: `load` reads project, user and global npmrc plus `npm_config_*` variables with env substitution, and `fromSourcesResult` is the pure form. `registryFor` applies scoped registries and `targetFor` yields the `RegistryTarget` `NpmRegistry` takes. Credentials stay `Redacted` and an unset variable fails as missing-env (#1132).
* `PackageTarball` authenticates a private-registry tarball with `credentialFor(tarballUrl)`.
* `credentialFor` matches only the request URL's own host, port and path, so a token never follows a scope, lookalike host, port or CDN URL.

## Bug Fixes

### Security

* npmrc credentials are kept off cleartext transports and out of printed output.
* Kept HTTP causes (`RegistryReadError`, `TarballError`) are redacted copies; the registry URL's userinfo is redacted in `RegistryReadError.registry`, `PublishError.registry` and span annotations. `@effected/npm` now depends on `@effected/crypto`.
