# @effected/pnpm-plugin-effect

The kit's one **companion** package (a category, not a tier): published and installable, but not a library — there is no API to import. It is a pnpm **config dependency** that centralizes Effect-ecosystem versioning via pnpm catalogs.

## Install (pnpm 11+, config install — not a normal add)

```bash
pnpm add --config @effected/pnpm-plugin-effect
```

This writes a `configDependencies` entry into the workspace's `pnpm-workspace.yaml`. Installing it any other way does NOT activate its catalogs/hooks.

## What it ships

Two catalog families and a pnpmfile:

- **`catalog:effect`** — every `effect`/`@effect/*` package pinned to ONE exact Effect v4 beta (`lock` strategy — no caret; a caret on a prerelease floats across the beta line). Applications use it in `dependencies`; libraries in `devDependencies`.
- **`catalog:effectPeers`** — the same package set at the computed shared peer floor; libraries declare it in `peerDependencies`.
- **`catalog:effect3` / `catalog:effect3Peers`** — latest Effect v3 (`interop` strategy) for dual-version testing; these drop at this plugin's own `1.0.0`.

## Usage (in a consuming workspace's package manifests)

```json
{
 "devDependencies": { "effect": "catalog:effect" },
 "peerDependencies": { "effect": "catalog:effectPeers" }
}
```

Application pattern — exact pin directly:

```json
{
 "dependencies": { "effect": "catalog:effect" }
}
```

## Testing machinery

None — no runtime code.

## Gotchas

- pnpm-only: config dependencies and catalogs have no npm/yarn equivalent.
- It publishes on the same `0.1.0` release gate as every library in the kit — a real public package, not repo infrastructure. (Its source manifest says `"private": true` like every package here; the bundler's `publishConfig` transform produces the publishable manifest.)
- Under v4 the catalogs are a convenience rather than a necessity (v3's peer-floor computation was the hard part) — optional, but shipped and supported.
