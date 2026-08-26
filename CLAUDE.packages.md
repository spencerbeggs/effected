# Package context files

Each package has its own `CLAUDE.md` and documents itself. Read it before working there; do not duplicate its content here. Parenthetical tags mark each **library's** tier (pure / boundary / integrated) per `effect-standards.md`; the companion has none.

- `semver` — strict SemVer 2.0.0 schemas; the repo's DX north star (pure).
- `jsonc` — zero-dependency JSONC parse/edit/format schemas (pure).
- `yaml` — zero-dependency YAML 1.2 parse/edit/format schemas, per-node comment fidelity, a public token stream and a yamllint-class lint system with autofix and config inference; the repo's largest (pure).
- `toml` — TOML parse/edit/format on a from-scratch engine (pure). `parse` accepts TOML 1.1.0, `stringify` emits 1.0.0 spellings — deliberate; never "fix" either side to match.
- `markdown` — CommonMark 0.31.2 + GFM as pure schemas: parse to mdast-shaped nodes with byte offsets, edit, format, mdast projection, frontmatter codecs; second in size only to `yaml` (pure).
- `glob` — the full minimatch dialect as pure string→predicate schemas; vendored, hardened engine (pure).
- `spdx` — SPDX identifiers, exceptions and license expressions as Schema classes; vendors the datasets as devDep-generated TypeScript (pure).
- `schema-org` — schema.org vocabulary as Schema classes, a `JsonLdDocument` assembler, a script-safe serializer and offline conformance validation over a vendored v30.0 vocabulary; two entrypoints, `.` and `./validate` (pure).
- `lockfiles` — bun/npm/pnpm/yarn lockfile parsers normalized into one `Lockfile` model, plus pure integrity checking (pure).
- `memfs` — a virtual POSIX volume behind core's `FileSystem` key: the kit's filesystem test double (pure). **No `@effected/*` edge, ever.**
- `github-references` — GitHub's issue-reference grammar as pure functions: three dialects; `github` keeps a droppable compat re-export (pure).
- `package-json` — package.json schemas, validation and file IO; delegates core SPDX validity to `@effected/spdx` (boundary).
- `tsconfig-json` — tsconfig.json schemas, `extends`-chain resolution and config discovery (boundary).
- `config-file` — composable config file loading: codec × resolver × strategy, the four codecs as free-standing named exports (boundary). Zero *external* runtime dependencies; peers on `jsonc`, `yaml` and `toml`.
- `npm` — resolution contracts for `catalog:` / `workspace:` specifiers plus the registry-read, tarball and publish services, which do their own IO through core contracts in `R` (boundary, deliberately — not integrated).
- `walker` — upward path traversal; the one absorbing loop (boundary).
- `xdg` — XDG Base Directory resolution: `AppDirs`, `NativeDirs`, `XdgPaths` and the config-file resolvers, over `walker` (boundary).
- `commands` — structured command running (`Run`) and CLI tool discovery (`ToolDiscovery`) over core's `ChildProcessSpawner`; declares the narrow `LocalExec` contract `workspaces` implements, keeping zero `@effected/*` edges (boundary).
- `git` — typed git introspection plus a marked mutating tier, a pure `GitConfig`/`Gitmodules` core, and argv redaction in `GitCommandError`, over core's ChildProcessSpawner in `R` (boundary).
- `templates` — managed `BEGIN`/`END` sections in files whose surrounding content belongs to the user; `FileSystem` required in `R`, `Path` deliberately not (boundary).
- `jsonl` — append-only, schema-validated JSONL journals as a definable service: envelope contract over a per-file event registry, a pure sync core, `Slice`-filtered reads that never materialize the file, an always-on watcher (boundary).
- `runtimes` — resolve semver-compatible Node, Bun and Deno versions from live feeds with an offline snapshot; its CLI binary ships from an external repo so consumers never install `@effect/platform-node` (boundary).
- `store` — durable local state: a migrated, schema-versioned SQLite `Store` and a TTL `Cache` with tag invalidation and eviction (integrated).
- `workspaces` — monorepo tooling: discovery, dependency graph, package-manager detection, pnpm catalogs, lockfile IO, git change detection; implements `npm`'s resolver contracts and `commands`' `LocalExec` (integrated).
- `github` — typed GitHub REST/GraphQL over octokit, with App auth, the resource services and the configuration-write half (secrets, variables, rulesets, environments); owns the octokit runtime, and the sealed-box crypto pair, so nothing downstream has to (integrated).
- `github-actions` — the Actions runtime services, the GitHub-surfaces reporting suite and the `sbom` seam adapters; the **one** package with `@effect/platform-node` as a required peer, and the only in-kit consumer of `templates`, `markdown` and `sbom` (integrated).
- `sbom` — supply-chain artifacts: CycloneDX 1.6 SBOMs, the NTIA minimum-elements report, in-toto statements and SLSA provenance, Sigstore DSSE signing (integrated).
- `schemastore` — Effect Schemas published as SchemaStore-shaped Draft-07 documents: `StoreDocument` assembly, catalog modes, fileMatch lint, `DocumentDiff`, write-if-changed `SchemaFile` IO, ajv-backed validation (integrated).
- `cli` — the CLI **boundary**: `CliLogger` (plain lines, `Error`+ to stderr), `CliRuntime` (report failures through the program's own logger, set the exit code) and the two issue renderers. Not a CLI framework — `effect/unstable/cli` owns parsing and this must never grow a second one. `@effected/config-file` is an **optional** peer (boundary).
- `app` — the application control plane: one layer wiring XDG-namespaced directories, a migrated SQLite `Store`, a TTL `Cache` and a config file to the same place (integrated). Nothing may depend on it.
- `pnpm-plugin-effect` — pnpm catalog/config plugin, publishing the Effect catalogs and the kit's own `effected` / `effected:peers` catalogs. The kit's one **companion**: **published to npm like every library here**, but not a library, so it has **no tier**.
