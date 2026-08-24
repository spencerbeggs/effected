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

- **`catalog:effect`** — every `effect`/`@effect/*` package pinned to ONE exact Effect v4 prerelease (`lock` strategy — no caret; a caret on a prerelease floats across the release line and desynchronizes the installed `effect` from the vendored source). Applications use it in `dependencies`; libraries in `devDependencies`.
- **`catalog:effect:peers`** — the same package set as the advertised peer range; libraries declare it in `peerDependencies`. Under `lock` it holds the same exact pin, not a caret floor.

The kit pair, for consumers of the kit only. Internal edges stay `workspace:*`, and these are **not** exported into the root `pnpm-workspace.yaml`:

- **`catalog:effected` / `catalog:effected:peers`** — every publishable kit package but one, `strategy: "lock-minor"`, `source: "workspace"`, holding each package's **next release** version.

Two constraints on the kit pair that are load-bearing rather than incidental:

- **`@effected/pnpm-plugin-effect` is deliberately absent from its own catalog and must stay absent.** Catalogue it and every rewrite bumps the plugin, which invalidates the catalog and writes another changeset — a release loop with no termination condition. The omission *is* the termination condition.
- **Membership is `publishConfig.access === "public"`, never `private === false`.** Every source manifest in the kit is `"private": true`; a check written against `private` classifies the whole kit as unpublishable and silently emits an empty catalog.

The Effect **v3** interop catalogs (`effect3` / `effect3:peers`) and the camelCase `effectPeers` alias were **removed** on the rc.109 advance. Do not reach for them and do not reintroduce them.

## Usage (in a consuming workspace's package manifests)

```json
{
 "devDependencies": { "effect": "catalog:effect" },
 "peerDependencies": { "effect": "catalog:effect:peers" }
}
```

Application pattern — exact pin directly:

```json
{
 "dependencies": { "effect": "catalog:effect" }
}
```

## Testing machinery

One suite, `__test__/allowed-versions.test.ts`, covering the allowed-versions generator (`allowed-versions.gen.ts`): the package's `pnpm:export` script first regenerates a `peerDependencyRules.allowedVersions` table — one version-qualified rule `"<satellite>@<its pin>>effect"` per v4 lock-catalog package, valued at the effect pin — as pure literals spliced between sentinel comments in `savvy.build.ts`, because the export CLI statically evaluates the config source and rejects computed values. A drift tripwire test fails whenever the committed table differs from regeneration, so a catalog advance cannot leave the table behind. Never a blanket or unqualified key: the version qualifier is what keeps a same-named Effect v3 satellite's genuine unmet peer warning alive, and the kit's own `@effected/*` artifacts are deliberately not covered (their stranding is repaired by the toolchain republish cycle).

## Gotchas

- pnpm-only: config dependencies and catalogs have no npm/yarn equivalent.
- It publishes on the same `0.1.0` release gate as every library in the kit — a real public package, not repo infrastructure. (Its source manifest says `"private": true` like every package here; the bundler's `publishConfig` transform produces the publishable manifest.)
- Under v4 the catalogs are a convenience rather than a necessity (v3's peer-floor computation was the hard part) — optional, but shipped and supported.
