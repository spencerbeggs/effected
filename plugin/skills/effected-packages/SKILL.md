---
name: effected-packages
description: The @effected package index — what each of the kit's 18 packages contains and when to reach for it. Use when working in a repo that uses @effected/* packages and about to add a capability the kit may already ship — parsing or editing JSONC/YAML/TOML, semver math, glob matching, package.json or tsconfig.json handling, lockfile parsing, config-file loading, upward path walking, XDG directories, SQLite state/caching, monorepo/workspace introspection, git introspection, or runtime-version resolution. Also use when choosing dependencies for a new Effect v4 app or library, or when a task names an @effected package. Rows route; per-package depth lives in references/.
---

# The @effected package index

`@effected/*` is an Effect v4-first app kit: 18 packages designed against the
v4 line (never lift-and-shifted from v3), released together, with every
`effect` dependency pinned to one exact beta via pnpm catalogs. Before
designing lockfile/config/glob/semver/path/state/workspace/git capability by
hand, check this table — the kit probably ships it, schema-first and with a
typed error channel.

**Tier vocabulary** (what depending on a package costs you): **pure** — peers
on `effect` only, no IO; **boundary** — does IO through core service contracts
(`FileSystem`, `Path`, `HttpClient`, `ChildProcessSpawner`) required in `R`,
so you provide one platform layer at the edge; **integrated** — carries a real
backend/runtime dependency that propagates to consumers. Check core first
(`effect-v4-module-index`), then the kit — never re-implement either.

## Index

Load a package's reference when you are about to import from it, design
against its services, or test code that uses it.

| Package | What it contains | Reach for it when | Tier | Reference |
| --- | --- | --- | --- | --- |
| `@effected/semver` | SemVer versions/ranges/comparators as Schema classes, range algebra, `VersionCache` service | any version parse/compare/range logic | pure | [semver.md](./references/semver.md) |
| `@effected/jsonc` | JSONC parse/edit/format schemas, AST, comment-preserving edits, visitor stream | reading or editing JSON-with-comments (tsconfig, VS Code-style config) | pure | [jsonc.md](./references/jsonc.md) |
| `@effected/yaml` | YAML 1.2 parse/edit/format schemas, error-tolerant AST, edits, visitor | any YAML read/write/transform | pure | [yaml.md](./references/yaml.md) |
| `@effected/toml` | TOML 1.0.0 parse/edit/format schemas, lossless CST, date-time value classes | any TOML read/write/transform | pure | [toml.md](./references/toml.md) |
| `@effected/glob` | full minimatch dialect as pure string→predicate schemas (`GlobPattern`, `GlobSet`) | matching path strings against globs without touching the fs | pure | [glob.md](./references/glob.md) |
| `@effected/npm` | resolver CONTRACTS for `catalog:`/`workspace:` specifiers + shared dependency vocabulary | typing dependency specifiers; needing the resolver seam | pure | [npm.md](./references/npm.md) |
| `@effected/lockfiles` | bun/npm/pnpm/yarn lockfile parsers → one `Lockfile` model + pure integrity checking | reading any lockfile; lockfile-vs-manifest drift checks | pure | [lockfiles.md](./references/lockfiles.md) |
| `@effected/package-json` | package.json schemas, `Package` model, validation, file IO service | reading/editing/validating package.json | integrated | [package-json.md](./references/package-json.md) |
| `@effected/tsconfig-json` | tsconfig schemas, tsc-parity `extends` resolution, nearest-config discovery | loading/resolving/discovering tsconfig files | boundary | [tsconfig-json.md](./references/tsconfig-json.md) |
| `@effected/config-file` | codec × resolver × strategy config loading, 4 codecs, encryption/migration decorators | any app/tool config-file loading | boundary | [config-file.md](./references/config-file.md) |
| `@effected/walker` | upward directory traversal (`ascend`, `firstMatch`, `findUpward`, `findRoot`) | find-nearest-file/marker-based root discovery | boundary | [walker.md](./references/walker.md) |
| `@effected/xdg` | XDG Base Directory resolution: `Xdg`, `AppDirs`, native dirs, config resolvers | platform-correct config/data/cache/state paths | boundary | [xdg.md](./references/xdg.md) |
| `@effected/git` | typed git introspection (show/ls-tree/refs/merge-base/diff/rev-parse) + checkout | reading repo state at any ref without checkout | boundary | [git.md](./references/git.md) |
| `@effected/runtimes` | Node/Bun/Deno version resolution from live feeds with offline snapshot | resolving runtime versions against ranges/phases | boundary | [runtimes.md](./references/runtimes.md) |
| `@effected/store` | migrated SQLite `Store` + TTL `Cache` with tags/eviction/events | durable local state or an on-disk cache | integrated | [store.md](./references/store.md) |
| `@effected/workspaces` | monorepo discovery, dependency graph, PM detection, catalogs, change detection, snapshots | any monorepo/workspace introspection | integrated | [workspaces.md](./references/workspaces.md) |
| `@effected/app` | the application control plane: one layer wiring XDG dirs + Store + Cache + config | wiring an APPLICATION's local state in one move | integrated | [app.md](./references/app.md) |
| `@effected/pnpm-plugin-effect` | pnpm catalogs pinning the Effect ecosystem (companion — config, not code) | setting up Effect version pinning in a pnpm workspace | — | [pnpm-plugin-effect.md](./references/pnpm-plugin-effect.md) |

## The two warnings every consumer inherits

- **`@effected/config-file`'s codecs are free-standing named exports**
  (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`) — import exactly the
  one you use and never collect them into a namespace object; a namespace
  object reaches every codec and silently drags every parsing engine into the
  bundle.
- **No library or package may depend on `@effected/app`** — but the application
  itself is exactly its intended consumer. It is the application control plane;
  a library taking it as a dependency drags integrated tier into every consumer,
  so libraries compose `xdg`/`store`/`config-file` directly.

## Cross-cutting facts

- Every package publishes a single flat CODE entrypoint (`@effected/<pkg>`) —
  with one exception: `@effected/workspaces` also ships
  `@effected/workspaces/node-sync`, Node bindings for its synchronous escape
  hatch. Everywhere else, no code subpath imports (each package also exports
  its own `./package.json` for tooling; that is metadata, not API).
- One platform layer at the edge discharges all IO: `NodeFileSystem.layer` +
  `NodePath.layer` for the fs-only packages (walker, xdg, config-file,
  package-json, tsconfig-json, workspaces), `NodeServices.layer` when
  `ChildProcessSpawner` is also needed (git, `Workspaces.layerWithGit`), or
  the `@effect/platform-bun` equivalents. `runtimes` needs only
  `FetchHttpClient.layer`; `store`'s sqlite layers bundle their own Node
  driver. Pure packages and every `layerTest`/`testLayer` need nothing.
- Parameterized layer factories (`ConfigFile.layer(...)`,
  `Store.layerSqlite(...)`, `App.layer(...)`, `WorkspaceDiscovery.layer(...)`)
  mint a fresh layer per call and layers memoize by reference — bind the
  result to a `const` once and reuse it.
- Test machinery worth knowing: `ConfigFile.testLayer`, `Store.layerTest`,
  `Cache.layerTest`, `App.layerTest`, `@effected/npm`'s `Default` noop
  resolvers, and `@effected/runtimes`' `.layerOffline`. Everything else tests
  against core layers (`FileSystem.layerNoop`, `Path.layer`) or a mocked
  `ChildProcessSpawner` — no platform package needed in unit tests.
- If a package feels like it is missing a service, a construct reads awkwardly,
  or you re-implement something twice, surface it to the user as an
  improvement suggestion for the kit — the ecosystem is actively dogfooding.
- **Adopting the kit from the v3-era predecessors** (`xdg-effect`,
  `config-file-effect`, `workspaces-effect`)? That's a rename **plus** real API
  breaks, not net-new wiring — the Effect v3→v4 map doesn't cover old kit → new
  kit. See [predecessor-bridge.md](./references/predecessor-bridge.md) for the
  per-package before/after tables.

## Related skills

`effect-v4-module-index` routes Effect core; this skill routes the kit. Check
core first — the kit deliberately requires core contracts (`FileSystem`,
`ChildProcessSpawner`) rather than re-declaring them.
