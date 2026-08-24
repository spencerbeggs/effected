---
"@effected/npm": minor
---

## Breaking Changes

### `setupAuth` takes a `credential`, not a `token`

`PackagePublish.setupAuth` no longer accepts a bearer `token`. It now takes a `credential: RegistryCredential`, the same closed union `NpmRegistry`'s read probe already used — so a probe and a publish can no longer authenticate differently against the same registry.

```ts
// before
yield* packagePublish.setupAuth({ registry, token, npmrcPath });

// after
yield* packagePublish.setupAuth({
	registry,
	credential: { kind: "token", token },
	npmrcPath,
});
```

For HTTP basic auth, use `{ kind: "basic", encoded }` — or build one from a username/password pair with the new `basicCredentialFromPair`.

### `RegistryTarget.token` is a deprecated tripwire

`RegistryTarget.token` is now typed `never` for one minor rather than removed outright. Passing it through a conditional spread (`...(token ? { token } : {})`) now fails to compile instead of silently dropping the field — an untyped drop would have turned an authenticated read into an anonymous one against a private registry. Migrate to `RegistryTarget.credential: RegistryCredential`.

## Features

* `PackageTarball` — a new service that downloads, verifies and extracts a published tarball, returning the directory its `package/` root was unpacked into. Fails typed (`TarballError`) on a missing version, a transport error, an integrity mismatch, or an extraction failure.
* `RegistryCredential` — the `TokenCredential` / `BasicCredential` union shared by `NpmRegistry` and `PackagePublish.setupAuth`, plus `basicCredentialFromPair` for building a basic credential from a username/password.
* `registryShortLabel`, `registryDisplayName` and `registryHost` — label projections for a registry URL or bare host, for use in publish reports and summaries.
* `NpmExecutor.withCacheDir` — redirects npm's cache directory (`--cache <dir>`), for runners whose default npm cache is partially root-owned.
* `NpmExecutor.withExtraArgs` — appends extra flags to every generated invocation.
