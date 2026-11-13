---
id: "0020"
title: "@effected/pnpm and @effected/npm/node: read pnpm settings, its registry view and an npmrc's proxy and TLS settings without a subprocess"
kind: adopt
shows: none
applies:
  "@effected/npm": ">=0.35.0"
  "@effected/workspaces": ">=0.48.0"
detect: ["pnpm[[:space:]]+config[[:space:]]+get", "pnpm[[:space:]]+view", "HTTPS?_PROXY", "undici"]
changesets: ["pnpm-manager-package-born", "bun-manager-package-born", "npm-transport-and-pnpm-split"]
---

Offer these to the user; never apply them unasked.

- **`PnpmSettings`** (`@effected/pnpm`) answers what `pnpm config get` reports, from the environment, `pnpm-workspace.yaml` and the global `config.yaml`, with no subprocess. `PnpmSettingsCatalog` on `@effected/pnpm/settings` types every pnpm 12 setting. Where a hit shells out to `pnpm config get`, propose it.
- **`PnpmNpmConfig.load`** builds the `NpmConfig` pnpm 12 would use (registries, credentials, proxy and TLS), so `NpmRegistry` reads what `pnpm view` would. Where a hit shells out to `pnpm view`, propose it.
- **`NpmHttpClient.layer(config, { env, packageManager })`** from `@effected/npm/node` is the Node `HttpClient` that applies the npmrc's proxy, `noproxy`, CA, client-certificate and `strict-ssl` settings. Environment proxies apply only when you pass `env`. Where a hit wires its own proxy agent or reads `HTTPS_PROXY` by hand, propose it; it needs `@effect/platform-node`.
- **`@effected/bun`** holds `BunLockDocument` for reading a `bun.lock` as written.

Check each name against the installed `.d.ts` before proposing it.
