---
id: "0039"
title: "catalog:effected:build replaces silk's catalog:build for the build chain and toolchain"
kind: tooling
shows: none
applies:
  "@effected/pnpm-plugin-effected": ">=0.24.0"
detect: ["\"catalog:build(:peers)?\""]
changesets: ["effected-build-catalog"]
closes: ["spencerbeggs/effected#1277"]
---

This applies to a repository that has `@effected/pnpm-plugin-effected` as a config dependency and builds with `effected package build`. A repository that still builds with the savvy bundlers can leave its manifests alone.

The plugin now serves a second catalog, `effected:build`, holding the build chain the kit's bundler runs and the toolchain it was built and tested with: `tsdown`, `@tsdown/exe`, `rolldown`, `rolldown-plugin-dts`, `@microsoft/api-extractor`, `@microsoft/api-extractor-model`, `@microsoft/tsdoc`, `@microsoft/tsdoc-config`, `typescript`, `@types/node`, `tsx`, `react`, `react-dom`, `@types/react`, `@types/react-dom` and `@rsbuild/core`.

- **Install the plugin release first, and rewrite the manifests second.** A manifest that names `catalog:effected:build` before the installed plugin serves that catalog fails the install with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`. So does every `pnpm run` after it, because pnpm installs before it runs a script. If you hit that error, move the config dependency first and rewrite the manifests afterwards. A repository that exports the plugin's catalogs into its own `pnpm-workspace.yaml` runs the export first, by calling the `rolldown-pnpm-config export` bin directly rather than through a `pnpm run` script.
- In every `package.json` the search matched, rewrite `catalog:build` to `catalog:effected:build` for each of those packages. Read the installed plugin's catalog, `node_modules/.pnpm-config/@effected/pnpm-plugin-effected`, for the exact member list.
- Rewrite a peer written as `catalog:build:peers` to `catalog:effected:build`. `catalog:effected:build:peers` does not exist for a consumer: the plugin hides it, as it hides `effected:peers`.
- Leave any other package on `catalog:build`, such as `@types/bun` or `@tsdown/css`, which the kit does not catalog. Leave silk's `lint`, `test`, `silk` and `docs` catalogs, its presets and its config dependency alone.
- A `react` or `@types/react` peer read from `catalog:silk:peers` can move to `catalog:effected:build` too, so its dev and peer ranges come from one catalog.

The plugin derives no override from this catalog. It does allow a TypeScript 7.1 prerelease under `tsdown`, with the same value silk declares, so running both plugins does not conflict. While silk is installed, its `tsdown>rolldown-plugin-dts` override still applies to the install. If the lockfile still resolves two `rolldown-plugin-dts` copies afterwards, that override is the cause, and the fix is in silk.

Verify with `pnpm install`. It must resolve every `catalog:effected:build` specifier. Then check the lockfile diff: the resolved versions should not move. Then run the build and the typecheck.
