# effected

**The unglamorous app plumbing that Effect leaves to you, done right.**

A pnpm monorepo (npm org `@effected`) of [Effect](https://effect.website/) v4 libraries designed v4-first, not lifted from their v3 predecessors. The repo holds libraries only; the applications that consume them stay in their own repos.

Every CLI, dev tool, and service reaches for the same machinery: reading and writing config files, parsing `package.json` and `tsconfig.json`, resolving semver ranges and runtime versions, walking a monorepo's workspaces and lockfiles, shelling out to git, finding the right XDG directory, keeping a little durable state on disk. effected gives you each of those as a typed Effect schema or service — malformed input surfaces as a typed error instead of a thrown exception, IO sits behind layers you can swap in a test, and the whole set shares one design so the pieces fit together.

Reach for one library or a dozen. Each package declares exactly what it touches, so a pure schema library never pulls a filesystem or a subprocess into your app, and they all pin the same Effect version, so their peer ranges never fight.

## Packages

Each package sits in one of four categories describing its runtime surface:

- **Integrated** — imports at least one runtime package outside `effect` core.
- **Boundary** — the same `@effected/*`-only dependency surface as a pure package, but does IO through Effect's core `FileSystem` and `Path` services.
- **Pure** — peers on `effect` and takes only `@effected/*` edges, with no IO.
- **Companion** — not a library and exposes no API; published and installable, it ships pnpm catalogs and a pnpmfile that pin your `effect` versions, your `@effected/*` versions and both sets of peer floors to the ones the kit was built against.

Every package is `unstable`; see [release strategy](#release-strategy).

### Integrated

| Package | Stability | Description |
| ------- | --------- | ----------- |
| [@effected/store](packages/store) | unstable | Durable local state on SQLite: a schema-versioned migrated store and a TTL cache with eviction, over one shared migration ledger |
| [@effected/workspaces](packages/workspaces) | unstable | Monorepo tooling as Effect services: root discovery, the dependency graph, package-manager detection, pnpm catalogs, lockfile IO and git change detection |
| [@effected/app](packages/app) | unstable | The application control plane: one layer wiring XDG-namespaced directories, a migrated SQLite store, a TTL cache and a config file to the same place |
| [@effected/github](packages/github) | unstable | Typed GitHub REST and GraphQL services over the octokit core request surface, with app auth and resource helpers |
| [@effected/github-actions](packages/github-actions) | unstable | The GitHub Actions runtime: env, inputs, outputs, state, logging, cache, artifacts, blob storage, OIDC and the token bridge |
| [@effected/sbom](packages/sbom) | unstable | CycloneDX 1.6 SBOM construction, SLSA provenance, NTIA validation and Sigstore signing as typed services |
| [@effected/schemastore](packages/schemastore) | unstable | Build, validate, version and publish SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources, with ajv strict-mode validation and a content-comparing emit pipeline |

### Boundary

| Package | Stability | Description |
| ------- | --------- | ----------- |
| [@effected/config-file](packages/config-file) | unstable | Composable config file loading for Effect: JSON, JSONC, YAML and TOML codecs, resolution strategies and merge behaviors |
| [@effected/walker](packages/walker) | unstable | Upward path traversal as Effect primitives: ascend a directory chain and return the first candidate satisfying a predicate |
| [@effected/xdg](packages/xdg) | unstable | XDG Base Directory resolution: environment paths, app-namespaced directories, native OS conventions and config-file resolvers |
| [@effected/runtimes](packages/runtimes) | unstable | Resolve semver-compatible Node.js, Bun and Deno runtime versions from live feeds, with an offline snapshot fallback |
| [@effected/package-json](packages/package-json) | unstable | package.json parsing, editing, validation and file IO as Effect schemas |
| [@effected/tsconfig-json](packages/tsconfig-json) | unstable | tsconfig.json handling as Effect schemas: JSONC document and compiler-option schemas, tsc-parity extends-chain resolution, nearest-config discovery and a portable subset for virtual TypeScript environments |
| [@effected/git](packages/git) | unstable | Typed git introspection over Effect core's ChildProcessSpawner: file content and trees at any ref, typed diffs and status, branch, commit and config probes — plus a clearly-marked mutating tier (checkout, fetch, submodules, sparse checkout, config, add) |
| [@effected/npm](packages/npm) | unstable | Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers, plus the kit's shared dependency vocabulary, a tolerant `Manifest` model, and the registry and publish services |
| [@effected/commands](packages/commands) | unstable | Structured command running and CLI tool discovery over Effect's core ChildProcessSpawner contract |
| [@effected/templates](packages/templates) | unstable | Managed-section blocks in user-editable files: parse, reconcile, sync and check delimited regions |
| [@effected/jsonl](packages/jsonl) | unstable | Append-only, schema-validated JSONL journals as a definable Effect service |
| [@effected/cli](packages/cli) | unstable | The boundary layer of an `effect/unstable/cli` program: plain CLI output, failure reporting and schema-issue rendering |

### Pure

| Package | Stability | Description |
| ------- | --------- | ----------- |
| [@effected/semver](packages/semver) | unstable | Strict SemVer 2.0.0 versions, ranges and comparators as Effect schemas |
| [@effected/jsonc](packages/jsonc) | unstable | Zero-dependency JSONC parsing, editing and formatting as Effect schemas |
| [@effected/yaml](packages/yaml) | unstable | Zero-dependency YAML parsing, editing, formatting and linting as Effect schemas, with per-node comment fidelity and a public token stream |
| [@effected/toml](packages/toml) | unstable | TOML 1.1.0 parsing, editing and formatting as Effect schemas: typed diagnostics, a lossless CST and first-class date-time values |
| [@effected/glob](packages/glob) | unstable | Full-fidelity glob matching as Effect schemas: the complete minimatch dialect compiled to pure string predicates |
| [@effected/lockfiles](packages/lockfiles) | unstable | Pure lockfile parsing for bun, npm, pnpm and yarn Berry into one unified Effect schema model, with pure integrity checking against workspace manifests |
| [@effected/spdx](packages/spdx) | unstable | SPDX license identifiers, exceptions and license expressions as Effect Schema classes |
| [@effected/markdown](packages/markdown) | unstable | CommonMark 0.31.2 and GFM as pure schemas: parse to mdast-shaped nodes with byte offsets, edit, format and project to and from mdast |
| [@effected/memfs](packages/memfs) | unstable | An isolated virtual POSIX volume behind Effect's core FileSystem service: the kit's filesystem test double, for tests and dry-run programs |
| [@effected/github-references](packages/github-references) | unstable | GitHub's issue-reference grammar as pure functions: inline-in-prose harvesting with offsets, bare-line parsing and the closing-list dialect |

### Companion

| Package | Stability | Description |
| ------- | --------- | ----------- |
| [@effected/pnpm-plugin-effect](packages/pnpm-plugin-effect) | unstable | pnpm config dependency shipping the catalogs that pin Effect and the `@effected/*` kit, for dependencies and peer ranges alike |

## Release strategy

Every package here is published to npm. Releases are changeset-driven: a change that affects a published package carries a changeset, and CI releases the packages those changesets name. That release is sometimes the whole kit and sometimes a single package — both are ordinary, and package versions move independently as a result. Each package's own npm page and `package.json` are the source of truth for where it stands.

What does not move independently is the Effect pin. Every package is built and tested against the one Effect v4 prerelease named in the `effect` catalog, so their peer ranges agree with each other by construction rather than by luck. Publishing runs ahead of the applications that consume the kit rather than behind them, which surfaces integration problems against real published packages instead of a stand-in.

### Pre-1.0.0

The kit stays pre-`1.0.0` until Effect `4.0.0` reaches general availability. Through development each package pins one Effect v4 prerelease rather than a floating range, which keeps the whole workspace building and testing against the exact same core. Packages graduate to `1.0.0` after Effect `4.0.0` is officially released.

### Version and stability

Two independent dimensions describe where a package stands:

- **Version** — pre-`1.0.0`, built against a single pinned Effect v4 prerelease. Each package carries its own version and advances when a release names it.
- **Stability** — `stable` or `unstable`, whether a package's API shape is considered complete. This is tracked per package.

Every package is `unstable` today. Treat the two as separate: even a package marked `stable` before `1.0.0` can break by accident, so pin exact versions. An exact pin turns an unexpected change into a type-check error at your own boundary instead of a runtime surprise in production.

### Version alignment

[`@effected/pnpm-plugin-effect`](packages/pnpm-plugin-effect) keeps a consumer's versions aligned with the kit's. It is a pnpm config dependency, installed ahead of the rest of the tree, that ships four pnpm catalogs: two for Effect and two for the kit itself.

The `effect` catalog carries the exact pinned prerelease for `effect` and its `@effect/*` satellites, under a `lock` strategy (`@effect/tsgo` is the exception: it versions independently and is pinned exactly at its own release), so once the plugin is installed everything in your workspace resolves to that one pinned version rather than drifting apart. `effect:peers` carries the same package set at the peer floor a library should advertise.

The `effected` catalog does the same job for the kit's own packages — every one except `@effected/pnpm-plugin-effect` itself, which is the package the catalog ships inside. Write `"@effected/workspaces": "catalog:effected"` in `dependencies`, or `catalog:effected:peers` in `peerDependencies`, instead of a hand-maintained range. That matters more than it sounds on `0.x`, where a caret does not cross a minor: a range written by hand stops resolving anything current as soon as the package it names cuts a minor, and it does so silently across every manifest that repeats it. The catalog is rebuilt as packages release, so upgrading the config dependency advances the whole kit surface in one step.

```json
{
  "dependencies": {
    "effect": "catalog:effect",
    "@effected/workspaces": "catalog:effected"
  }
}
```

### A note on peers

Upstream Effect manifests occasionally introduce peer-dependency wrinkles (a caret range where an exact pin was expected, for instance) that need an override rule to keep resolution clean. Expect this corner to be revisited a few times before Effect `4.0.0` ships.

## Contributing

Setup, the build pipeline, testing, code quality and the commit and pull-request flow live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Requirements

- Node.js >=24.11.0
- pnpm 11.x

## License

[MIT](LICENSE)
