# effected

A pnpm monorepo (npm org `@effected`) building an [Effect](https://effect.website/) v4 app kit: a set of libraries designed for Effect v4 from the start, not lifted from their v3 predecessors. The repo holds libraries only; the applications that consume them stay in their own repos.

## Packages

| Package | Tier | Description |
| ------- | ---- | ----------- |
| [@effected/semver](packages/semver) | pure | Strict SemVer 2.0.0 versions, ranges and comparators as Effect schemas |
| [@effected/jsonc](packages/jsonc) | pure | Zero-dependency JSONC parsing, editing and formatting as Effect schemas |
| [@effected/yaml](packages/yaml) | pure | Zero-dependency YAML parsing, editing and formatting as Effect schemas |
| [@effected/toml](packages/toml) | pure | TOML 1.0.0 parsing, editing and formatting as Effect schemas: typed diagnostics, a lossless CST and first-class date-time values |
| [@effected/package-json](packages/package-json) | integrated | package.json parsing, editing, validation and file IO as Effect schemas |
| [@effected/npm](packages/npm) | pure | Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers |
| [@effected/config-file](packages/config-file) | boundary | Composable config file loading for Effect: JSON, JSONC, YAML and TOML codecs, resolution strategies and merge behaviors |
| [@effected/walker](packages/walker) | boundary | Upward path traversal as Effect primitives: ascend a directory chain and return the first candidate satisfying a predicate |
| [@effected/glob](packages/glob) | pure | Full-fidelity glob matching as Effect schemas: the complete minimatch dialect compiled to pure string predicates |
| [@effected/lockfiles](packages/lockfiles) | pure | Pure lockfile parsing for bun, npm, pnpm and yarn Berry into one unified Effect schema model, with pure integrity checking against workspace manifests |
| [@effected/store](packages/store) | integrated | Durable local state on SQLite: a schema-versioned migrated store and a TTL cache with eviction, over one shared migration ledger |
| [@effected/xdg](packages/xdg) | boundary | XDG Base Directory resolution: environment paths, app-namespaced directories, native OS conventions and config-file resolvers |
| [@effected/workspaces](packages/workspaces) | integrated | Monorepo tooling as Effect services: root discovery, the dependency graph, package-manager detection, pnpm catalogs, lockfile IO and git change detection |
| [@effected/runtime-resolver](packages/runtime-resolver) | boundary | Resolve semver-compatible Node.js, Bun and Deno runtime versions from live feeds, with an offline snapshot fallback |
| [@effected/runtime-resolver-cli](packages/runtime-resolver-cli) | integrated | The command-line interface for @effected/runtime-resolver |
| [@effected/pnpm-plugin-effect](packages/pnpm-plugin-effect) | infra | pnpm config dependency for centralized catalog management across the Effected ecosystem |

Tier describes a package's runtime surface: **pure** packages peer on `effect` and take only `@effected/*` edges with no IO, **boundary** packages have the same dependency surface but do IO through Effect's core `FileSystem` and `Path` services and **integrated** packages import at least one runtime package outside `effect` core. `pnpm-plugin-effect` is repo infrastructure and sits outside the taxonomy.

## Releases

Nothing here is published to npm yet. The whole kit ships together at 0.1.0 once it can replace the business logic of the five applications that define its scope, and 1.0.0 waits for Effect v4 GA. No package is released on its own, so every peer range names the same Effect v4 beta on day one.

## Roadmap

Two packages remain before the kit is complete, in order: `ts-vfs`, which fetches, caches and resolves TypeScript type definitions from npm so type-aware tooling can typecheck samples, and `app-kit`, a thin composition over `xdg`, `config-file` and `store` for wiring an application's control plane.

## Development

```bash
pnpm install     # install workspace dependencies
pnpm build       # build dev + prod outputs via Turbo
pnpm test        # run all tests with Vitest
pnpm lint        # check code with Biome
pnpm typecheck   # type-check each package
pnpm dev         # run the docs site locally
```

Dependency versions are pinned through pnpm catalogs in `pnpm-workspace.yaml`, so every package builds against the same Effect v4 beta. [Turbo](https://turbo.build/) orchestrates the build graph and each package emits dual development and production outputs with [@savvy-web/bundler](https://github.com/savvy-web/bundler). The docs site in `website/` runs on [RSPress](https://rspress.dev/).

## Requirements

- Node.js >=24.11.0
- pnpm 11.x

## License

[MIT](LICENSE)
