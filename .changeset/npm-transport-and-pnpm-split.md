---
"@effected/npm": minor
---

## Breaking Changes

* `ReleaseAgeGate` moved to `@effected/pnpm`. Import it from there.
* Yarn is no longer a manager this package models. The yarn branches of `PackageManagerPin`, `PackageManagerCache` (`yarn-classic`, `yarn-berry`), `IntegrityHash` (the yarn form and `isYarnChecksum`), `PackageTarball` and `NpmConfig` are removed, so a value that only decoded as yarn now fails to decode.
* `@effect/platform-node` is an optional peer dependency, needed only by the new `./node` subpath.

## Features

### Network transport

The new `./node` subpath exports `NpmHttpClient` and `NpmTransportError`. The client honours the npmrc network settings: `proxy`, `https-proxy` and `noproxy`, `ca`, `cafile` and `ca[]`, `strict-ssl`, and per-registry `certfile` and `keyfile`. This closes #1307.

### Release age and config

* `NpmReleaseAge` reads the release-age setting from npm configuration.
* `NpmConfig` reads list settings written `key[]=` and exposes them through `list(key)`.
* `fromSourcesResult` accepts `{ npmEnvironment }`.
* In pnpm mode, proxy environment variables are read in upper case first.
* `PackageTarball` carries a `changelog` field.
* `PackageLockDocument` models `package-lock.json`, and `LockfileDocumentError` reports a document that cannot be read.
