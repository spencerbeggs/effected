# @effected/pnpm-plugin-effect

The kit's one **companion** package (a category, not a tier): published and installable, but not a library — there is no *application-facing* API to import. It is a pnpm **config dependency** that centralizes Effect-ecosystem versioning via pnpm catalogs.

Its source does export one value from the published entrypoint — `catalogs` from `@effected/pnpm-plugin-effect`, a generated re-export of `rolldown-pnpm-config/virtual/catalogs`, built from the catalog table declared in `savvy.build.ts` — plus a second, `hooks`, from an internal `src/pnpmfile.ts` module that carries no package.json export path at all (pnpm's config-dependency loader locates it by convention, not through the public `exports` map). Both exist for pnpm's own tooling to consume; nothing in a normal application dependency graph imports either.

## Install (pnpm 11+, config install — not a normal add)

```bash
pnpm add --config @effected/pnpm-plugin-effect
```

This writes a `configDependencies` entry into the workspace's `pnpm-workspace.yaml`. Installing it any other way does NOT activate its catalogs/hooks.

## What it ships

**Four catalogs** — two pairs with different jobs — and a pnpmfile.

The Effect pair, consumed by every `@effected/*` package:

- **`catalog:effect`** — every `effect`/`@effect/*` package on the stable Effect v4 line, a caret range (`^4.0.0`) under the `lock-minor` strategy. Effect releases `effect` and every `@effect/*` package together at one shared version, so they resolve together; the exact version a repo builds against is its **lockfile's resolution**, not the catalog literal, and the vendored `.repos/effect` source should be re-pinned whenever that resolution moves. `@effect/tsgo` is the exception — its own range on its own version line, unrelated to `effect`'s. Applications use it in `dependencies`; libraries in `devDependencies`.
- **`catalog:effect:peers`** — the same package set as the advertised peer range (`^4.0.0` for `effect` and its satellites); libraries declare it in `peerDependencies`. `lock-minor` floors peer patches, so a peer never demands a newer patch than a consumer has.

The kit pair, for consumers of the kit only. Internal edges stay `workspace:*`, and these are **not** exported into the root `pnpm-workspace.yaml`:

- **`catalog:effected` / `catalog:effected:peers`** — every publishable kit package but one, `strategy: "lock-minor"`, `source: "workspace"`, holding each package's **next release** version.

Two constraints on the kit pair that are load-bearing rather than incidental:

- **`@effected/pnpm-plugin-effect` is deliberately absent from its own catalog and must stay absent.** Catalogue it and every rewrite bumps the plugin, which invalidates the catalog and writes another changeset — a release loop with no termination condition. The omission *is* the termination condition.
- **Membership is `publishConfig.access === "public"`, never `private === false`.** Every source manifest in the kit is `"private": true`; a check written against `private` classifies the whole kit as unpublishable and silently emits an empty catalog.

The Effect **v3** interop catalogs (`effect3` / `effect3:peers`) and the camelCase `effectPeers` alias are gone. Do not reach for them and do not reintroduce them.

## Usage (in a consuming workspace's package manifests)

```json
{
 "devDependencies": { "effect": "catalog:effect" },
 "peerDependencies": { "effect": "catalog:effect:peers" }
}
```

Application pattern — the catalog range directly (the lockfile fixes the exact version):

```json
{
 "dependencies": { "effect": "catalog:effect" }
}
```

## Testing machinery

One suite, `__test__/catalog.test.ts`, in two parts:

- **The `effected` catalog.** It reads the `PnpmConfigPlugin(...)` literal from `savvy.build.ts` the way the upgrade CLI does, without importing it, and asserts that every publishable package except the plugin itself is a member, in the object form that emits a peers catalog.
- **The scoped overrides.** It imports the built `pnpmfile.mjs` from `dist/dev/pkg`, the `publishConfig.directory`, and checks the `@effect/platform-node-shared` pins merge with a consumer's own `overrides`, with a consumer value for the same selector winning.

The `peerDependencyRules.allowedVersions` table has no generator or test of its own. `rolldown-pnpm-config` derives it at build time from the `effect` catalog (`allowedVersionsFromCatalogs`, one version-qualified `"<satellite>@<version>>effect"` rule per exact entry). The `effect` satellites share `effect`'s own caret range, so only a package on its own version line, such as `@effect/tsgo`, gets a rule. The qualifier keeps a same-named Effect v3 satellite's genuine unmet-peer warning alive.

## Gotchas

- pnpm-only: config dependencies and catalogs have no npm/yarn equivalent.
- It publishes on the same `0.1.0` release gate as every library in the kit — a real public package, not repo infrastructure. (Its source manifest says `"private": true` like every package here; the bundler's `publishConfig` transform produces the publishable manifest.)
- The catalogs are a convenience rather than a necessity — optional, but shipped and supported.
