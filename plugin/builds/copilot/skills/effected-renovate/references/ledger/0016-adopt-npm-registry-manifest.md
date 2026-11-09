---
id: "0016"
title: "@effected/npm: NpmRegistry.manifest reads a version's dependency fields through the registry service"
kind: adopt
shows: none
applies:
  "@effected/npm": ">=0.31.0"
detect: ["pnpm view", "npm view"]
closes: ["spencerbeggs/effected#1170"]
---

Offer this to the user; never apply it unasked. It removes the last reason to shell out to `pnpm view` beside `NpmRegistry`, which resolves one package through two registry and credential paths that can disagree.

`NpmRegistry.manifest(name, version, target?)` answers an `Option` of `VersionManifest`, carrying `name`, `version`, `dependencies`, `peerDependencies`, `optionalDependencies`, `peerDependenciesMeta` and `engines`. Each dependency field is absent when the document does not declare it. It routes as `version` does, GitHub Packages included, and takes the same `RegistryTarget`.

- A 404 or an absent version is `Option.none()`.
- A malformed dependency record fails `RegistryReadError` with kind `decode`, rather than reading as "no peers".
- An `engines` value in the legacy array form is omitted rather than failing the read.

Check the fields a shell-out's caller reads against what `VersionManifest` carries, because anything else in the document is not exposed.

**Behind a proxy or an internal CA, `NpmRegistry` alone is not a drop-in for `pnpm view`.** The shell-out honoured the npmrc's `proxy`, `https-proxy`, `noproxy`, `strict-ssl`, `ca` and `cafile`. `NpmRegistry` applies none of them: it reads over the `HttpClient` in its context, and core's fetch client uses only what that client was built with. Keep the shell-out until the client is configured, or build it from the npmrc:

- `NpmConfig.transport` reads the settings, the superset npm and pnpm read, with proxy URLs as `Redacted`. `transport.isDefault` is `true` when none is set, so a caller can warn when it is `false` and its client applies nothing.
- `NpmConfig.proxyFor(registryUrl, process.env, { packageManager })` answers the proxy that manager would use for the URL, following its precedence, environment fallback and bypass rules. A pnpm repository passes `{ packageManager: "pnpm" }`.
- `NpmConfig.tlsFor(registryUrl, { packageManager })` answers a registry's own CA and client-certificate settings.
- Apply them in the client layer: `Layer.succeed(FetchHttpClient.RequestInit, { dispatcher })` beside `FetchHttpClient.layer`, with an undici `ProxyAgent` built from the proxy URL, `requestTls.ca` from the CA, and `rejectUnauthorized: transport.strictSsl`. Or run under `NODE_USE_ENV_PROXY=1` and `NODE_EXTRA_CA_CERTS`, whose `NO_PROXY` matching follows curl rather than npm.
- `ca[]` and `noproxy[]` array forms in an npmrc are not read; write the scalar forms.

Read the installed `.d.ts` for the exact shapes.
