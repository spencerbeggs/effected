---
"@effected/pnpm-plugin-effected": minor
---

## Features

### The `effected:build` catalog

A second catalog, `effected:build`, holds the build chain `effected package build` runs and the toolchain a package builds against. A repository that builds with the kit takes these from the kit rather than from `@savvy-web/pnpm-plugin-silk`'s `build` catalog:

* `tsdown`, `@tsdown/exe`, `rolldown` and `rolldown-plugin-dts`
* `@microsoft/api-extractor`, `@microsoft/api-extractor-model`, `@microsoft/tsdoc` and `@microsoft/tsdoc-config`
* `typescript`, `@types/node` and `tsx`
* `react`, `react-dom`, `@types/react`, `@types/react-dom` and `@rsbuild/core`

```json
{
  "devDependencies": {
    "typescript": "catalog:effected:build",
    "@types/node": "catalog:effected:build"
  }
}
```

* `rolldown-plugin-dts` sits on `^0.30.0`, the line `tsdown` asks for itself, and the plugin adds no override for it
* No graph-wide override is derived from the catalog
* The pnpmfile admits a TypeScript 7.1 prerelease under `tsdown`, whose own `typescript` peer admits none
* A consumer's own `effected:build` entry wins over the plugin's, and the `:peers` twin stays hidden
