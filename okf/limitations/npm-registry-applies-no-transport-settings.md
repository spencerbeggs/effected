---
type: Limitation
title: NpmRegistry applies none of the npmrc proxy or TLS settings
description: NpmRegistry and PackageTarball send every request through the caller's HttpClient and apply no npmrc transport setting (proxy, https-proxy, http-proxy, noproxy, no-proxy, strict-ssl, ca, cafile, cert, key, local-address, and the per-registry //host/:ca, :cafile, :cert, :certfile, :key, :keyfile); NpmConfig reads them, as npm 11 and 12 and pnpm do, through NpmConfig.transport, NpmConfig.proxyFor and NpmConfig.tlsFor; on Node the @effected/npm/node subpath ships NpmHttpClient.layer, the client that applies them, and the runtime-neutral root stays free of any proxy agent.
status: draft
bounds: ../modules/npm.md
tags:
  - architecture
sources:
  - id: npm-config-source
    resource: ../../packages/npm/src/NpmConfig.ts
  - id: npm-registry-source
    resource: ../../packages/npm/src/NpmRegistry.ts
  - id: issue-1307
    resource: https://github.com/spencerbeggs/effected/issues/1307
  - id: npm-source
    resource: npm 11.20.0 (as installed) and npm 12.2.2 (packed), npm-registry-fetch/lib/index.js, npm-registry-fetch/lib/auth.js, @npmcli/agent/lib/proxy.js, make-fetch-happen/lib/options.js, @npmcli/config/lib/parse-field.js, @npmcli/config/lib/index.js
  - id: pnpm-source
    resource: pnpm 11.28.9 (packed), dist/pnpm.mjs
  - id: pnpm-docs
    resource: https://pnpm.io/npmrc and https://pnpm.io/settings/network
generated:
  by: "okfit/claude-code"
  at: 2026-11-13T06:47:43Z
integrity:
  generated:
    body: 9291b7452a93f5f6
---

# NpmRegistry applies none of the npmrc proxy or TLS settings

## The condition

`NpmRegistry` reads over the `HttpClient` the caller provides, and
`PackageTarball` downloads the same way. Neither one applies an npmrc
transport setting.[^npm-registry-source] The connection belongs to the
client, and the kit
[requires its services in `R` and owns no backend](../conventions/require-in-r-default.md),
so no proxy agent or CA bundle loader lives in the root entry. On Node, the `./node` subpath supplies one; see [the Node remedy](#the-node-remedy).

## The observable symptom

A tool that replaces `npm view` or `pnpm view` with `NpmRegistry`, and
provides core's `FetchHttpClient.layer`, stops working for the users who
configured an npmrc to get through their network: a registry reachable
only through a proxy, or signed by an internal CA, fails every read as
`RegistryReadError` kind `"transport"`, where `npm view` succeeded. Nothing
reports that the settings were present and unused.[^issue-1307]

## The Node remedy

`@effected/npm/node` ships `NpmHttpClient.layer(config, { env, packageManager })`,
the Node `HttpClient` that applies a resolved `NpmConfig`'s transport
settings, built on `NpmConfig.proxyFor` and `NpmConfig.tlsFor`. Provide it
beneath `NpmRegistry` and `PackageTarball` and the reads connect the way npm
does. A tool replacing `pnpm view` builds its config with `PnpmNpmConfig`
and passes `packageManager: "pnpm"`. A setting it cannot apply (an
unreadable `cafile`, `certfile` or `keyfile`, or a proxy that is not an
`http`, `https` or `socks5` URL) fails the layer with `NpmTransportError`
when it is built. The limitation stands for the root entry and for any
runtime without the `./node` subpath, such as Workers, where a plain
`HttpClient` still applies no npmrc setting. See [npm](../modules/npm.md)
and [pnpm](../modules/pnpm.md).

## What the package does instead

`NpmConfig` reads the settings so the caller can act on them, and each
field's TSDoc names which package manager reads it.[^npm-config-source]

- `NpmConfig.transport` is an `NpmTransportSettings` record. Read by both
  managers: `https-proxy`, `proxy`, `noproxy`, `strict-ssl`, `ca`,
  `cafile`, `local-address`, and the inline `cert` and `key` (pnpm sends
  them; npm passes them as a deprecated fallback). Read by pnpm only:
  `http-proxy`, `no-proxy`, and `proxy=false` as "no proxy at all"
  (`proxyDisabled`). Proxy URLs, `cert` and `key` are `Redacted`.
  `isDefault` tells a caller whose client ignores the settings that it
  should warn.
- `NpmConfig.tlsFor(url, { packageManager })` is the registry's own TLS:
  `//host/:ca`, `:cafile`, `:cert`, `:certfile`, `:key` and `:keyfile`,
  `https:` only, by either manager's matching rule. Under npm's rule
  (`regFromURI`/`hasAuth`, the default), the walk is the one `credentialFor`
  uses, deepest key first, with and without each trailing slash. It stops
  at the first key holding any auth (`_authToken`, `_auth`,
  `username`+`_password`, or a `certfile`+`keyfile` pair) and answers only
  that key's pair. A lone `certfile` or a pnpm-only `ca` does not stop it,
  and a credential with no pair answers `None`. Under pnpm's rule
  (`pickSettingByUrl`), only slash-terminated keys from the URL's directory
  up to `//host[:port]/` are tried, then the same again without the port.
  The first key holding any of the six fields answers with all of them,
  and a credential does not stop the walk. So one npmrc on one host can
  answer differently: `//host/acme/:_authToken` above a root
  `certfile`/`keyfile` pair gives no client certificate for `/acme/…` under
  npm, and the root pair under pnpm. Neither rule reaches another host. npm
  reads only the `certfile`/`keyfile` pair; pnpm reads all six, and a
  registry's own `ca`, `cert` or `key` replaces the top-level one.
- `NpmConfig.proxyFor(url, env, { packageManager })` resolves the proxy by
  npm's rules (the default) or pnpm's, because the two route the same
  npmrc differently.

**`strict-ssl` reads the same under both managers: only the literal
`false` turns verification off.** npm's `parseField` maps `false` to
`false` and `null` to nothing, then `make-fetch-happen` sets
`rejectUnauthorized` to `strictSSL !== false`;[^npm-source] pnpm's ini
reader JSON-parses only `true`/`false`/`null` and passes
`rejectUnauthorized: strictSsl ?? true`.[^pnpm-source] So `0`, `FALSE`,
`null` and an empty value all verify. Reading it with `nopt`'s boolean
rule would have turned verification off for `strict-ssl=0` and
`strict-ssl=null`.

## How npm and pnpm differ

npm 11 and npm 12 do not differ on any of this: the proxy, TLS and
`strict-ssl` code in `@npmcli/agent`, `npm-registry-fetch` and
`make-fetch-happen` is the same in both, and the definitions of these
settings are textually identical.[^npm-source] Two npm 12 changes touch
the edges. It refuses to run with a top-level `certfile` or `keyfile`
(`ERR_INVALID_AUTH`, which `npm config fix` repairs by moving the pair under
the default registry) where npm 11 ignored one; neither major ever read a
top-level pair, so the kit holds none. And its proxy agents can do
Negotiate (SPNEGO) proxy authentication, but no npm setting turns that on.

pnpm (11 from source, 12 from its documentation, since 12 ships as a
native binary) differs from npm in five ways that `proxyFor` models
under `packageManager: "pnpm"`:[^pnpm-source][^pnpm-docs]

- An `https:` request uses `https-proxy`, else `proxy`, else `HTTPS_PROXY`.
  Any other request uses `http-proxy`, else that `https:` answer, else
  `HTTP_PROXY`, else `PROXY`. npm uses `https-proxy`, else `proxy`, for
  every scheme.
- `proxy=false` turns proxying off, the environment included. npm reads it
  as unset.
- The bypass list is `no-proxy`, else `noproxy`, else `NO_PROXY`, and a
  bare `true` **setting** bypasses every host, because pnpm's ini reader
  makes it a boolean. A `NO_PROXY=true` variable stays the string `true`, a
  host name like any other. npm reads only `noproxy`.
- A variable is read in upper case, else lower case, as pnpm 12's
  `apply_proxy_cascade` reads it (pnpm 11 read lower case first), and a
  set-but-empty one counts as a value: `HTTPS_PROXY=""` means no proxy and
  stops the fallback to `https_proxy` and, for `http:`, to `HTTP_PROXY`. npm
  reads any case, the last spelling in the environment's order winning, and
  skips an empty value.
- A proxy written without a scheme takes the request's.

The matching itself is the same: dot-separated labels compared from the
right, no `*` wildcard, no ports. One difference: pnpm also drops empty
labels from the host, so a trailing-dot name (`registry.example.com.`) is
bypassed by `example.com` under pnpm and not under npm.

A proxy URL may carry userinfo in either form, `http://user:pass@proxy`
or the scheme-less `user:pass@proxy:3128` that pnpm completes with the
request's scheme. `NpmConfig.settings` holds every proxy key (`proxy`,
`https-proxy`, `http-proxy`) with that userinfo removed in both forms, and
`secrets` holds the original. A non-proxy value is not read scheme-less,
because `email=me@example.com` is not userinfo, and `noproxy`/`no-proxy`
hold host names, never userinfo.

Not modelled, because `NpmConfig` resolves npm's file layering rather
than pnpm's: pnpm reads no global npmrc, reads its own `auth.ini`, also
takes network settings from `pnpm-workspace.yaml`, and declines to expand
`${VAR}` in a project npmrc's proxy and registry values unless that file is
also the user npmrc.[^pnpm-source] A pnpm-written configuration that relies
on any of those reads differently here.

## The recipe without the Node subpath

Outside Node, or where the subpath is unwanted, the wiring belongs in the application:

- launch Node with `NODE_USE_ENV_PROXY=1` and `NODE_EXTRA_CA_CERTS`, and
  Node then honours the environment rather than the npmrc; or
- provide `FetchHttpClient.RequestInit` with a `dispatcher` beside
  `FetchHttpClient.layer`. Use undici's `ProxyAgent` for the URL
  `proxyFor` answered, with `requestTls` carrying the CA and client
  certificate (from `transport` and `tlsFor`) and
  `rejectUnauthorized: transport.strictSsl`. A probe confirmed that a
  userland undici `ProxyAgent` passed this way routes core's fetch client
  through a proxy on Node 26.

The two routes do not read `NO_PROXY` alike. `proxyFor` matches it as npm
and pnpm do, while Node's `NODE_USE_ENV_PROXY` follows the curl
convention, where `*` bypasses every host and an entry with a port
matches that port only. A caller should not expect the same environment
to route the same way on both.

The values are only as trustworthy as the npmrc they came from. A cloned
repository's project npmrc can set `https-proxy` and `strict-ssl=false`
and route token-bearing reads through a host it controls, exactly as it
can for npm. A tool that should not trust its checkout can build the
configuration from the user and global files alone.

## What is not read

The contents of any file named by a path setting are not read by
`NpmConfig`: paths are held as written, not resolved. `NpmHttpClient.layer`
reads them when it is built. The array forms `ca[]` and `noproxy[]` are
read through `NpmConfig.list`.

## What the fix would take

A client for a runtime other than Node would need that runtime's proxy
mechanism. The Node client lives on the `./node` subpath because its
dispatcher is Node-only, and a Workers or browser equivalent would be its
own entry, built when a consumer needs it.

[^npm-registry-source]: `packages/npm/src/NpmRegistry.ts` — the class
    remarks name the gap and the recipe.
[^issue-1307]: effected#1307, filed from rolldown-pnpm-config's adoption
    of `NpmRegistry` in place of `pnpm view`.
[^npm-config-source]: `packages/npm/src/NpmConfig.ts` —
    `NpmTransportSettings`, `NpmRegistryTls`, `ProxyForOptions`,
    `NpmConfig.transport`, `NpmConfig.tlsFor` and `NpmConfig.proxyFor`.
[^npm-source]: npm 11.20.0 and 12.2.2, where every file named here is
    byte-identical: `npm-registry-fetch` `lib/index.js` passes
    `proxy: opts.httpsProxy || opts.proxy` beside `ca`, `cert`, `key`,
    `noProxy` and `strictSSL`; `@npmcli/agent` `lib/proxy.js` `getProxy`
    holds the environment fallback and `isNoProxy` the bypass match;
    `make-fetch-happen` `lib/options.js` `configureOptions` decides
    `rejectUnauthorized`; `@npmcli/config` `lib/parse-field.js` trims and
    maps `false` and `null`; and `npm-registry-fetch` `lib/auth.js`
    `regFromURI`/`hasAuth` stop at the first key holding any auth, while the
    `Auth` constructor reads a client certificate only for a
    `certfile && keyfile` pair. npm 12's `@npmcli/config` `lib/index.js`
    `validate` flags a top-level `certfile`/`keyfile` and throws
    `ErrInvalidAuth`.
[^pnpm-source]: pnpm 11 `dist/pnpm.mjs`, read at 11.28.9 (a review
    re-checked 11.28.11 with the same behaviour; line numbers shift between
    patches, so these are function names): `resolveProxySettings` (the
    install path's proxy and bypass resolution, `getProcessEnv` for the
    variables), `getProxyDispatcher` (the proxy picked by scheme),
    `parseProxyUrl` (a scheme-less proxy takes the request's scheme),
    `checkNoProxy`/`toReversedLabels`/`isHostCoveredByNoProxyEntry` (the
    bypass match), `collectNetworkConfigEntry`/`tryParseSslKey` with
    `SSL_SUFFIX_RE` (the per-registry TLS keys), `pickSettingByUrl` with
    `pickSettingByNerfDartParentPath` and `removePort` (their lookup),
    `pickTlsConfig` (a registry's own settings over the top-level ones), the
    bundled ini parser (`true`/`false`/`null` become JSON values), the
    dispatchers' `rejectUnauthorized: strictSsl ?? true`, and
    `readNpmrcSources` (the project npmrc's restricted env expansion).
    `createPackageManagerNetworkConfig` is a second, trusted-only resolution
    used only to fetch pnpm itself, not for registry reads.
[^pnpm-docs]: pnpm.io/npmrc (the certificate settings, the per-registry
    `<URL>:ca`/`:cafile`/`:cert`/`:certfile`/`:key`/`:keyfile`,
    `NODE_EXTRA_CA_CERTS`) and pnpm.io/settings/network (`httpsProxy`,
    `httpProxy`, `proxy: false`, `noProxy`, `localAddress`, `strictSsl`).
    These are the authority for pnpm 12, whose published package is a
    native binary with no readable source.
