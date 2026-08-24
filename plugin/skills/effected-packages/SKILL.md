---
name: effected-packages
description: The @effected package index — what each of the kit's 30 packages contains and when to reach for it. Use when working in a repo that uses @effected/* packages and about to add a capability the kit may already ship — parsing or editing JSONC/YAML/TOML/Markdown, semver math, SPDX license expressions, glob matching, an in-memory filesystem for tests, package.json or tsconfig.json handling, lockfile parsing, config-file loading, upward path walking, XDG directories, SQLite state/caching, monorepo/workspace introspection, unsatisfied peer-dependency detection, git introspection, runtime-version resolution, running commands or discovering CLI tools, managed sections in generated files, append-only JSONL journals and watching them, the GitHub REST/GraphQL API, parsing GitHub issue references (`Closes #12`) out of a commit message or PR body, the GitHub Actions runtime, CLI output and failure reporting, SBOM generation and signing, or publishing Effect Schemas as SchemaStore-shaped JSON Schema documents. Also use when choosing dependencies for a new Effect v4 app or library, or when a task names an @effected package. Rows route; per-package depth lives in references/.
---

# The @effected package index

`@effected/*` is an Effect v4-first app kit: 30 packages (29 libraries plus
the `pnpm-plugin-effect` companion) designed against the
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
| `@effected/toml` | TOML parse/edit/format schemas, lossless CST, date-time value classes; parses 1.1.0, emits 1.0.0 spellings | any TOML read/write/transform | pure | [toml.md](./references/toml.md) |
| `@effected/markdown` | CommonMark 0.31.2 + GFM parse/edit/format as pure schemas: 28 constructible mdast-shaped node classes with byte offsets, offset-splice edits, node-level modify, `Mdast` projection both ways, `Stream` visitor, frontmatter codecs, section finders (`firstSection` / `sectionByHeading`) | reading, editing, querying or rewriting markdown — **and building it**: `new Table(...)` → `Markdown.stringify` — instead of `remark`/`mdast-util-*`/`gray-matter` | pure | [markdown.md](./references/markdown.md) |
| `@effected/spdx` | SPDX license IDs, exceptions and license *expressions* as Schema classes, with a hardened depth-capped expression parser and vendored SPDX datasets | validating or parsing a license field / expression (`MIT OR Apache-2.0 WITH …`) | pure | [spdx.md](./references/spdx.md) |
| `@effected/glob` | full minimatch dialect as pure string→predicate schemas (`GlobPattern`, `GlobSet`) | matching path strings against globs without touching the fs | pure | [glob.md](./references/glob.md) |
| `@effected/memfs` | in-memory implementation of core's `FileSystem` contract: an isolated virtual POSIX volume behind the standard `FileSystem.FileSystem` key — `MemoryFileSystem.layer` (empty volume) / `layerWith(seed)` (absolute-POSIX-path → `string` \| `Uint8Array`, parents auto-created); unseeded reads fail typed `NotFound`, never fabricate | any test needing a filesystem — instead of hand-stubbing `FileSystem.layerNoop` (the stub answering `""` is the documented footgun it exists to kill) | pure | [memfs.md](./references/memfs.md) |
| `@effected/npm` | resolver CONTRACTS for `catalog:`/`workspace:` specifiers + shared dependency vocabulary, **plus** `NpmRegistry` (reads over `HttpClient`) and `PackagePublish` (the npm CLI over `commands`) | typing dependency specifiers; reading a registry; packing/publishing | boundary | [npm.md](./references/npm.md) |
| `@effected/lockfiles` | bun/npm/pnpm/yarn lockfile parsers → one `Lockfile` model of package *instances* (`instanceId`, `resolved`, `unresolvedEdges`, `peerDependencies`) + pure integrity checking; parses pnpm `lockfileVersion` 9+ and npm `lockfileVersion` 3+ only, older formats fail typed | reading any lockfile; lockfile-vs-manifest drift checks | pure | [lockfiles.md](./references/lockfiles.md) |
| `@effected/package-json` | package.json schemas, `Package` model, validation, file IO service; `repository`/`bugs`/`homepage`/`maintainers`/`keywords` now typed | reading/editing/validating package.json | boundary | [package-json.md](./references/package-json.md) |
| `@effected/tsconfig-json` | tsconfig schemas, tsc-parity `extends` resolution, nearest-config discovery | loading/resolving/discovering tsconfig files | boundary | [tsconfig-json.md](./references/tsconfig-json.md) |
| `@effected/config-file` | codec × resolver × strategy config loading, 4 codecs, encryption/migration decorators, one-shot `ConfigFile.read(path, { schema, codec })` | any app/tool config-file loading | boundary | [config-file.md](./references/config-file.md) |
| `@effected/jsonl` | append-only, schema-validated JSONL journals as a definable service: an event registry + envelope contract (`at`/`event`/`scope`/`data`), a pure sync core for runtime-free readers, `Slice`-filtered `query`/`changes`/`projection`, and a watcher so cooperating writers cross-observe each other's appends | an append-only journal/event log on disk, agent-state files, or watching a JSONL file another process appends to | boundary | [jsonl.md](./references/jsonl.md) |
| `@effected/walker` | upward directory traversal (`ascend`, `firstMatch`, `findUpward`, `findRoot`) | find-nearest-file/marker-based root discovery | boundary | [walker.md](./references/walker.md) |
| `@effected/xdg` | XDG Base Directory resolution: `Xdg`, `AppDirs`, native dirs, config resolvers | platform-correct config/data/cache/state paths | boundary | [xdg.md](./references/xdg.md) |
| `@effected/git` | 72 typed members in two tiers — a read tier (show/ls-tree/ls-files/refs/merge-base/diffs/status/ls-remote) and a marked mutating tier (checkout/fetch, restore trio, stash, branches, tags, remotes, worktrees, commit/push/pull, submodules, config, staging) — plus a PURE `GitConfig`/`Gitmodules` document core and argv redaction on every error | reading repo state at any ref without checkout, driving git as a program, or parsing/editing a git-config or `.gitmodules` file losslessly | boundary | [git.md](./references/git.md) |
| `@effected/runtimes` | Node/Bun/Deno version resolution from live feeds with offline snapshot | resolving runtime versions against ranges/phases | boundary | [runtimes.md](./references/runtimes.md) |
| `@effected/commands` | `Run` combinators over core `ChildProcess.Command` (collect/text/lines/json/`jsonLine`/detach, typed failure, redaction, transient retry) + `ToolDiscovery` + the `LocalExec` contract `workspaces` implements | running any subprocess, framing a JSON protocol payload out of a noisy child's stdout, or asking whether a CLI tool is installed and which copy to use | boundary | [commands.md](./references/commands.md) |
| `@effected/templates` | managed sections: delimited BEGIN/END blocks inside user-editable files, with reconcile/sync/check and a parameterized marker + comment style | writing generated content into a file a human also edits | boundary | [templates.md](./references/templates.md) |
| `@effected/schemastore` | Effect Schemas published as SchemaStore-shaped Draft-07 JSON Schema documents: `SchemaPipeline` (the generate → lint → validate → gate → write loop), `StoreDocument` assembly (owning the `#/$defs` restore), versioned/unversioned catalog modes, fileMatch hygiene lint, `DocumentLint`, language-server annotation carriers, `SchemaValidator` shipping closed over ajv, `DocumentDiff` change classification, content-comparing `SchemaFile` IO | emitting editor-consumable JSON Schema from Effect Schemas, or publishing a catalog to SchemaStore | integrated | [references/schemastore.md](references/schemastore.md) |
| `@effected/store` | migrated SQLite `Store` + TTL `Cache` with tags/eviction/events | durable local state or an on-disk cache | integrated | [store.md](./references/store.md) |
| `@effected/workspaces` | monorepo discovery, dependency graph, PM detection, catalogs (with three `ConfigDependencyHooks` replay layers — noop / in-process / subprocess), change detection, snapshots, versioning/tag strategies, `PeerCheck` unsatisfied-peer detection over a parsed lockfile; implements `npm`'s resolvers and `commands`' `LocalExec` | any monorepo/workspace introspection, or asking whether a workspace's peer graph is satisfied (npm/pnpm/bun — not yarn) | integrated | [workspaces.md](./references/workspaces.md) |
| `@effected/github` | typed GitHub REST + GraphQL over octokit's core request surface, App auth, resources (branches/tags/commits/releases/PRs/checks), pagination, one error taxonomy — **plus the configuration-WRITE half**: `GitHubRepository` settings (`repositoryPatch` builds a cast-free partial patch, dropping `undefined` fields), `Ruleset`, repo/environment secrets and variables (it owns the sealed-box crypto), `DeploymentEnvironment`, `CodeScanning`, `Attestation` | any GitHub API call — the route literal types params AND response, no casts — **and configuring a repository**: settings, rulesets, secrets, variables, environments | integrated | [github.md](./references/github.md) |
| `@effected/github-references` | GitHub's issue-reference grammar as PURE functions — the canonical nine closing keywords plus the separate non-closing `ref`/`refs`/`references` set, and three dialects: inline-in-prose (`harvestIssueReferences`, offsets, no colon), bare-line (`parseBareLineReference`, colon optional), closing-list (`parseClosingList`/`parseReferenceList`, `,`/`and`/Oxford `, and`), plus the whole-text sweeps (`parseBareLines`, `parseClosingLists`, `parseReferenceLists`, `harvestReferenceLists`, `collectReferenceLists`) and `keywordFamily` | parsing `Closes #12` out of a commit message, PR body or changelog — instead of hand-rolling a regex, which is the documented way to report a link GitHub never made | pure | [github-references.md](./references/github-references.md) |
| `@effected/github-actions` | the Actions RUNTIME: inputs/outputs/state/env, workflow commands, logger, cache, artifacts, tool installer, OIDC, the `GitHubToken` bridge; plus the reporting/document suite (`GitHubMarkdown`, `ManagedDocument`, `CheckDocument`/`CheckState`) and the sbom-seam adapters (`ActionsProvenance`, `ActionsIdentityToken`) | writing a GitHub Action — talking to the runner, not the API | integrated | [github-actions.md](./references/github-actions.md) |
| `@effected/sbom` | owned CycloneDX 1.6 emitter, Sigstore signing, in-toto/SLSA provenance, NTIA minimum-elements validation | generating, signing or attesting an SBOM | integrated | [sbom.md](./references/sbom.md) |
| `@effected/app` | the application control plane: one layer wiring XDG dirs + Store + Cache + config | wiring an APPLICATION's local state in one move | integrated | [app.md](./references/app.md) |
| `@effected/cli` | the CLI **boundary**: `CliLogger` (plain rendering, `Error`+ to stderr), `CliRuntime` (report failures through the program's own logger, set the exit code), schema/config issue renderers | a command-line program on `effect/unstable/cli` — Effect's default logger prints `[00:33:56.619] INFO (#2)` at a user, and `runMain` reports failures on **stdout** through a logger outside your layers | boundary | [cli.md](./references/cli.md) |
| `@effected/pnpm-plugin-effect` | pnpm catalogs pinning the Effect ecosystem (companion — config, not code) | setting up Effect version pinning in a pnpm workspace | — | [pnpm-plugin-effect.md](./references/pnpm-plugin-effect.md) |

**Every row now has a `references/` file** — the last eight (`spdx`, `cli`,
`commands`, `templates`, `github`, `github-references`, `github-actions`,
`sbom`) landed 2026-08-23. Each package's own `CLAUDE.md` remains the
authority when the two disagree; the reference is the routing layer over it.
For `github`, `github-actions` and `commands` specifically, depth also lives
one level up: `building-a-github-action` routes a 14-skill suite (capability
references plus `designing-an-action`'s build sequence) covering these three
packages and `npm`/`sbom` in more depth than one reference file can — start
there when you are actually building an action.

Facts about the kit that change how you depend on it:

- **`@effected/markdown` peers on `@effected/yaml` / `@effected/toml` /
  `@effected/jsonc` *optionally*** (`peerDependenciesMeta`), consumed only by the
  three frontmatter codec modules. Parsing markdown pulls in none of them. Note
  also that **markdown→HTML and HTML→markdown are permanently out of scope**: to
  render, project via `Mdast` and hand the plain-mdast tree to a renderer.
- **`@effected/package-json` delegates license validity to `@effected/spdx`** —
  do not re-validate an SPDX expression yourself downstream of it.
- **`@effected/commands` owns no subprocess vocabulary.** Commands are core
  `ChildProcess.Command` values built with core's own constructors; `Run` adds
  the outcome (collected output, typed failure), the policy (timeout,
  redaction, transience) and the tool. It ships no spawner backend — you provide
  a platform layer at the edge, as with any boundary package.
- **`@effected/github-actions` is the ONE package in the kit with a required
  `@effect/platform-node` peer.** An action always compiles into Node on a
  GitHub runner, so there is no second platform to abstract over. Its
  `@azure/storage-blob` dependency is confined to three modules and asserted by
  a reachability test — import `ActionOutputs` and you cannot link Azure.
- **`@effected/sbom`'s entrypoint re-exports `Package`, `Person` and
  `Repository` from `@effected/package-json`** — a consumer constructing
  `SbomMetadataSource` inputs imports them from `@effected/sbom` directly
  instead of adding the `package-json` edge itself.
- **`@effected/github` re-exports exactly six names from
  `@effected/github-references`** (`CLOSING_KEYWORDS`, `ClosingKeyword`,
  `IssueReference`, `harvestIssueReferences`, `BareLineReference`,
  `parseBareLineReference`) as a **droppable compat shim** for consumers of the
  grammar's old home. New consumers import `@effected/github-references`
  directly — it is pure and octokit-free. The closing-list surfaces are
  deliberately NOT re-exported from `github`; widening that shim would make it
  permanent by accident.
- **`@effected/github` deliberately omits `@octokit/rest` and
  `@octokit/auth-app`.** The former is a second spelling of the endpoint types;
  the latter makes ~492 KB of OAuth machinery reachable from a package that only
  mints installation tokens. Do not reintroduce either.
- **`@effected/memfs` has zero `@effected/*` edges — by law, not accident** —
  so ANY kit package may devDepend on it for tests without creating a cycle
  (`glob` included: the engine keeps its embedded mini-glob; do not
  "deduplicate" it). The engine is vendored from Effect-TS/effect PRs
  #6573/#6555, with a planned sunset when core ships its own in-memory
  `FileSystem`.
- **`@effected/workspaces` publishability has NO ambient default.** Every
  composite (`Workspaces.layer`, `layerWithGit`, …) *requires*
  `PublishabilityDetector` — provide `PublishabilityDetector.layerNpm` for npm
  semantics, `layerNone`, or your own policy. It used to supply npm semantics
  itself, and because `Layer.mergeAll` is last-wins, the natural spelling of an
  override (`Layer.mergeAll(mine, Workspaces.layer())`) silently lost to it.
  Each shipped policy is also reachable as a **value**
  (`PublishabilityDetector.npm`), so a policy that wraps npm semantics does not
  have to re-enter the tag it is replacing.

## Local-build dogfood state (updated 2026-08-14)

**Every package in the kit has published** — `@effected/cli` cleared its first
release and is at `0.2.0`; nothing is awaiting a debut. `commands`, `templates`, `github`,
`github-actions` and `sbom` — the github-split five — published for the first
time in the 2026-07-26 wave (16 packages, PR #181) at `0.1.0`, `schemastore`
in the 2026-08-03 wave, `jsonl` reached `0.2.0` in the 27-package
beta.107 wave (2026-08-11, PR #325), and `memfs` published first at `0.1.0`
in the 2026-08-14 consumer-unblock wave, and `github-references` was extracted
from `github` on 2026-08-17 at `0.1.0`. Nothing in the kit sits at `0.0.0`.

Releases are changeset-driven: CI builds the appropriate changesets and
releases the packages they name. That may be the whole kit on a beta advance
or a single package on a patch — a package can be released on its own, and
solo patches like `workspaces@0.11.1` are ordinary. A downstream repo
mid-dogfood-loop may still consume unreleased branch work from the local
`effected` checkout via `file:` overrides. Everything published is `0.x` and
unstable.

Three standing directives for a downstream repo rebuilding against this kit:

- **The dogfood main agent runs Fable and orchestrates** — it delegates rather
  than implements: reasoning-heavy work to opus, mechanical work to sonnet.
- **No branching and no changesets in downstream repos during the rebuild.**
  Work lands on the working branch; release bookkeeping comes later, once the
  rebuild settles.
- **Mid-loop branch work resolves from the local checkout.** While a dogfood
  loop is linked, a downstream manifest points at it (a workspace link or a
  `file:`/`overrides:` entry) rather than a registry range, until the next
  release wave carries the work.

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
  `ChildProcessSpawner` is also needed (git, `Workspaces.layerWithGit`,
  `Workspaces.layerWithConfigDependenciesSubprocess`), or
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
  against core layers (`Path.layer`, `FileSystem.layerNoop` for a single
  trivially-stubbed member — `@effected/memfs` for anything more) or a mocked
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

**Construct-level coverage — does every export get named somewhere in
`skills/` — is checked, not maintained by hand here.**
`plugin/__test__/construct-coverage.bats` walks each covered package's
`src/index.ts` export list against every skill file, phased in starting from
six packages (`github-actions`, `github`, `commands`, `npm`, `schemastore`,
`jsonl`). This file's prose is what that check verifies isn't silently
orphaned, not the source of truth for whether a given export is covered — a
hand-maintained claim of completeness drifts the same way this file's own
stale reference-file count once did.
