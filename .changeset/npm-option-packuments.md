---
"@effected/npm": minor
---

## Breaking Changes

### Packument reads answer `Option`

`NpmRegistry.versions`, `distTags` and `publishTimes` return an `Option`. `None` means the registry answered 404 for the package. `Some([])` or `Some({})` means a package the registry knows that lists nothing. Before, both were an empty collection, so a mistyped package name read as a package with no versions.

* `layerSeeded` answers `None` for an unseeded package
* A `layerTest` stub of these members returns an `Option`

```ts
const registry = yield* NpmRegistry;
const known = Option.match(yield* registry.versions("@scope/name"), {
  onNone: () => "not on this registry",
  onSome: (versions) => `${versions.length} versions`,
});
```

## Features

### The npmrc transport settings

`NpmRegistry` still applies no proxy or TLS setting itself: it reads over the `HttpClient` in its context. These read the settings, so a caller can build that client from them.

* `NpmConfig.transport` is an `NpmTransportSettings`: the proxy, bypass, `strict-ssl`, CA, inline client-certificate and `local-address` settings, the superset npm and pnpm read. Proxy URLs and inline keys are `Redacted`
* `NpmConfig.proxyFor(url, env, { packageManager })` answers the proxy npm or pnpm would use for a URL, following that manager's precedence, environment fallback and bypass rules
* `NpmConfig.tlsFor(url, { packageManager })` answers an `NpmRegistryTls`, a registry's own `//host/:ca|cafile|cert|certfile|key|keyfile` settings, matched the way that manager matches them
* `strict-ssl` is off only for a literal `false`
* A proxy URL's userinfo, with or without a scheme, is stripped from `NpmConfig.settings`

## Bug Fixes

* Reading a fully unpublished package, whose packument carries `time.unpublished` as an object, no longer fails `RegistryReadError` with kind `decode`
* The seeded double reads its seeds as own keys only, so `versions("constructor")` no longer reads `Object`
