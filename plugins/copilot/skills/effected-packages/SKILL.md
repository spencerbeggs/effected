---
name: effected-packages
description: >-
  The @effected package index — what each kit package contains and when to reach for it. Use when working in a
  repo that uses @effected/* packages and about to add a capability the kit may already ship — parsing/editing
  JSONC/YAML/TOML/Markdown, semver, SPDX, glob matching, an in-memory filesystem for tests,
  package.json/tsconfig/lockfile/config-file handling, monorepo/workspace introspection, peer-dependency
  detection, git introspection, runtime-version resolution, running commands, managed sections, JSONL journals,
  the GitHub REST/GraphQL API and Actions runtime, CLI output and failure reporting, cross-front-end primitives
  for a CLI or MCP boundary, serving or testing an MCP server over stdio, SBOM generation and signing, or
  publishing SchemaStore JSON Schema or schema.org JSON-LD. Also use when choosing dependencies for a new Effect
  v4 app or library. Rows route; per-package depth lives in references/; per-construct intent search lives in
  references/constructs/.
---

# The @effected package index

`@effected/*` is an Effect v4-first app kit: 34 packages (32 libraries plus
the `pnpm-plugin-effect` and `schemastore-cli` companions) designed against the
v4 line, released together, with every
`effect` dependency pinned to one exact prerelease via pnpm catalogs. Before
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
| `@effected/memfs` | in-memory implementation of core's `FileSystem` contract: an isolated virtual POSIX volume behind the standard `FileSystem.FileSystem` key — `MemoryFileSystem.layer` (empty volume) / `layerWith(seed)` (absolute-POSIX-path → `string` \| `Uint8Array` \| tagged `file`/`directory`/`symlink` entries, parents auto-created); unseeded reads fail typed `NotFound`, never fabricate; `layerInspectable`/`layerInspectableWith(seed)` additionally publish `Volume` for sync write read-back (resolve it under the same provide — the layer forms re-seed per build), `layerFaultyWith(seed, faults)` injects typed per-method faults delegate-by-default (self-contained; `layerFaulty(faults)` wraps a base `FileSystem` you provide — the no-seed standalone case is `layerFaultyWith({}, faults)`) | any test needing a filesystem — instead of hand-stubbing `FileSystem.layerNoop` (the stub answering `""` is the documented footgun it exists to kill) | pure | [memfs.md](./references/memfs.md) |
| `@effected/npm` | resolver CONTRACTS for `catalog:`/`workspace:` specifiers + shared dependency vocabulary, **plus** `NpmRegistry` (reads over `HttpClient`) and `PackagePublish` (the npm CLI over `commands`) | typing dependency specifiers; reading a registry; packing/publishing | boundary | [npm.md](./references/npm.md) |
| `@effected/lockfiles` | bun/npm/pnpm/yarn lockfile parsers → one `Lockfile` model of package *instances* (`instanceId`, `resolved`, `unresolvedEdges`, `peerDependencies`) + pure integrity checking; parses pnpm `lockfileVersion` 9+ and npm `lockfileVersion` 3+ only, older formats fail typed | reading any lockfile; lockfile-vs-manifest drift checks | pure | [lockfiles.md](./references/lockfiles.md) |
| `@effected/package-json` | package.json schemas, `Package` model, validation, file IO service; `repository`/`bugs`/`homepage`/`maintainers`/`keywords` now typed | reading/editing/validating package.json | boundary | [package-json.md](./references/package-json.md) |
| `@effected/tsconfig-json` | tsconfig schemas, tsc-parity `extends` resolution, nearest-config discovery | loading/resolving/discovering tsconfig files | boundary | [tsconfig-json.md](./references/tsconfig-json.md) |
| `@effected/config-file` | codec × resolver × strategy config loading, 4 codecs, encryption/migration decorators, one-shot `ConfigFile.read(path, { schema, codec })` | any app/tool config-file loading | boundary | [config-file.md](./references/config-file.md) |
| `@effected/engine` | platform-free primitives shared across a tool's front ends: `Distribution`/`DistributionField`/`CurrentDistribution`/`distributionSuffix` (carrier identity), `Remediation` (what a caller should do after a failure), `LaunchContext.projectDir` (resolving an agent-launched project directory from caller-supplied `argv`/`env`/`cwd` — no `process` read inside) | sharing carrier-distribution identity, a remediation shape, or launch-context resolution between a CLI and an MCP server front end — pattern: `design-patterns` | pure | [engine.md](./references/engine.md) |
| `@effected/jsonl` | append-only, schema-validated JSONL journals as a definable service: an event registry + envelope contract (`at`/`event`/`scope`/`data`), a pure sync core for runtime-free readers, `Slice`-filtered `query`/`changes`/`projection`, and a watcher so cooperating writers cross-observe each other's appends | an append-only journal/event log on disk, agent-state files, or watching a JSONL file another process appends to | boundary | [jsonl.md](./references/jsonl.md) |
| `@effected/walker` | upward directory traversal (`ascend`, `firstMatch`, `findUpward`, `findRoot`) | find-nearest-file/marker-based root discovery | boundary | [walker.md](./references/walker.md) |
| `@effected/xdg` | XDG Base Directory resolution: `Xdg`, `AppDirs`, native dirs, config resolvers | platform-correct config/data/cache/state paths | boundary | [xdg.md](./references/xdg.md) |
| `@effected/git` | 72 typed members in two tiers — a read tier (show/ls-tree/ls-files/refs/merge-base/diffs/status/ls-remote) and a marked mutating tier (checkout/fetch, restore trio, stash, branches, tags, remotes, worktrees, commit/push/pull, submodules, config, staging) — plus a PURE `GitConfig`/`Gitmodules` document core and argv redaction on every error | reading repo state at any ref without checkout, driving git as a program, or parsing/editing a git-config or `.gitmodules` file losslessly | boundary | [git.md](./references/git.md) |
| `@effected/runtimes` | Node/Bun/Deno version resolution from live feeds with offline snapshot | resolving runtime versions against ranges/phases | boundary | [runtimes.md](./references/runtimes.md) |
| `@effected/commands` | `Run` combinators over core `ChildProcess.Command` (collect/text/lines/json/`jsonLine`/detach, typed failure, redaction, transient retry) + `ToolDiscovery` + the `LocalExec` contract `workspaces` implements | running any subprocess, framing a JSON protocol payload out of a noisy child's stdout, or asking whether a CLI tool is installed and which copy to use | boundary | [commands.md](./references/commands.md) |
| `@effected/templates` | managed sections: delimited BEGIN/END blocks inside user-editable files, with reconcile/sync/check and a parameterized marker + comment style | writing generated content into a file a human also edits | boundary | [templates.md](./references/templates.md) |
| `@effected/schema-org` | schema.org vocabulary as Schema classes (`SoftwareSourceCode`, `TechArticle`, `APIReference`, `Person`, `Organization`, `CreativeWork`), a `JsonLdDocument` assembler with `@id` cross-references, a script-embeddable escaped serializer, and offline conformance validation against the vendored v30.0 vocabulary behind a separate `./validate` entrypoint | emitting schema.org JSON-LD for a page, or gating structured data in CI without calling a live validator | pure | [schema-org.md](./references/schema-org.md) |
| `@effected/schemastore` | Effect Schemas published as SchemaStore-shaped Draft-07 JSON Schema documents: `SchemaPipeline` (the generate → lint → validate → gate → write loop), `StoreDocument` assembly (owning the `#/$defs` restore), versioned/unversioned catalog modes, fileMatch hygiene lint, `DocumentLint`, the declared-family annotation gate, the `SchemaValidator` contract (engine-free; the ajv engine lives in `schemastore-cli`), `HostedSchema` for a derived `$schema`/`$id` identity, `DocumentDiff` change classification, content-comparing `SchemaFile` IO | emitting editor-consumable JSON Schema from Effect Schemas, deriving the `$schema` URL an application writes, or publishing a catalog to SchemaStore | boundary | [references/schemastore.md](references/schemastore.md) |
| `@effected/schemastore-cli` | the `schemastore` command over `@effected/schemastore`: `schemastore build` / `schemastore check` a `schemastore.config.ts` (`defineConfig`), a per-schema `published` flag, a drift policy (`--drift`, `--on-drift`, `--force`), JSON output, a GitHub step summary, exit codes 0/1/2/3/64; also exports `AjvValidator.layer`, the one shipped ajv engine, for a program driving `SchemaPipeline` itself | publishing SchemaStore documents from a consumer repository without writing a generator script — install as a devDependency; `@effected/schemastore` is the runtime dependency (peers; released as a fixed pair) | companion (no tier) | [references/schemastore-cli.md](references/schemastore-cli.md) |
| `@effected/store` | migrated SQLite `Store` + TTL `Cache` with tags/eviction/events | durable local state or an on-disk cache | integrated | [store.md](./references/store.md) |
| `@effected/workspaces` | monorepo discovery, dependency graph, PM detection, catalogs (with four `ConfigDependencyHooks` replay layers — noop / in-process / subprocess / a hermetic `layerFrom` map — every replaying one loading the pnpmfile of the DECLARED config-dependency version — live/subprocess from `.pnpm-config` or the pnpm store, `layerFrom` from its map — so `at(ref)` diffs hook-only catalogs across a config-dependency bump), change detection, snapshots, versioning/tag strategies, `PeerCheck` unsatisfied-peer detection over a parsed lockfile; implements `npm`'s resolvers and `commands`' `LocalExec`, plus `@effected/workspaces/testing` (`WorkspaceLayering`, `PackedInstall`, `SourceBoundary`) | any monorepo/workspace introspection, or asking whether a workspace's peer graph is satisfied (npm/pnpm/bun — not yarn), or checking a monorepo's layering, packed install or source boundaries in its own tests | integrated | [workspaces.md](./references/workspaces.md) |
| `@effected/github` | typed GitHub REST + GraphQL over octokit's core request surface, App auth, resources (branches/tags/commits/releases/PRs/checks), pagination, one error taxonomy — **plus the configuration-WRITE half**: `GitHubRepository` settings (`repositoryPatch` builds a cast-free partial patch, dropping `undefined` fields), `Ruleset`, repo/environment secrets and variables (it owns the sealed-box crypto), `DeploymentEnvironment`, `CodeScanning`, `Attestation` | any GitHub API call — the route literal types params AND response, no casts — **and configuring a repository**: settings, rulesets, secrets, variables, environments | integrated | [github.md](./references/github.md) |
| `@effected/github-references` | GitHub's issue-reference grammar as PURE functions — the canonical nine closing keywords plus the separate non-closing `ref`/`refs`/`references` set, and three dialects: inline-in-prose (`harvestIssueReferences`, offsets, no colon), bare-line (`parseBareLineReference`, colon optional), closing-list (`parseClosingList`/`parseReferenceList`, `,`/`and`/Oxford `, and`), plus the whole-text sweeps (`parseBareLines`, `parseClosingLists`, `parseReferenceLists`, `harvestReferenceLists`, `collectReferenceLists`) and `keywordFamily` | parsing `Closes #12` out of a commit message, PR body or changelog — instead of hand-rolling a regex, which is the documented way to report a link GitHub never made | pure | [github-references.md](./references/github-references.md) |
| `@effected/github-actions` | the Actions RUNTIME: inputs/outputs/state/env, workflow commands, logger, cache, artifacts, tool installer, OIDC, the `GitHubToken` bridge; plus the reporting/document suite (`GitHubMarkdown`, `ManagedDocument`, `CheckDocument`/`CheckState`) and the sbom-seam adapters (`ActionsProvenance`, `ActionsIdentityToken`) | writing a GitHub Action — talking to the runner, not the API | integrated | [github-actions.md](./references/github-actions.md) |
| `@effected/sbom` | owned CycloneDX 1.6 emitter, Sigstore signing, in-toto/SLSA provenance, NTIA minimum-elements validation | generating, signing or attesting an SBOM | integrated | [sbom.md](./references/sbom.md) |
| `@effected/app` | the application control plane: one layer wiring XDG dirs + Store + Cache + config | wiring an APPLICATION's local state in one move | integrated | [app.md](./references/app.md) |
| `@effected/cli` | the CLI **boundary**: `CliLogger` (plain rendering, `All` to stderr by default), `CliRuntime` (report failures through the program's own logger, set the exit code; `CliRuntime.main` assembles a whole program), `CliExit` (findings exit non-zero without a crash), `CliColor` (the no-color.org decision), schema/config issue renderers, plus `@effected/cli/testing`'s `CliTest` for spawning a built bin in tests | a command-line program on `effect/unstable/cli` — Effect's default logger prints `[00:33:56.619] INFO (#2)` at a user, and `runMain` reports failures on **stdout** through a logger outside your layers — teaching skill: `effect-v4-cli` | boundary | [cli.md](./references/cli.md) |
| `@effected/mcp` | the MCP boundary: `McpStdio` (`layerStdio` with stderr logging, a launch that never reports on stdout, teardown mapping stdin EOF to 0), `ToolFailure` (remediation folded into the wire message), `ToolInputSchema` (every unknown key at every depth), `McpToolkit` (registers a toolkit strict-by-default, naming every unknown key in one response), plus `@effected/mcp/testing` (`McpHarness`, `McpProcess`, `McpProbe`, `McpToolAudit`, `McpTestFailure`) | an MCP server on `effect/unstable/ai` — `runMain` reports a launch failure on stdout, which is the JSON-RPC wire, and a declared failure reaches the agent as message text only — teaching skill: `effect-v4-mcp` | boundary | [mcp.md](./references/mcp.md) |
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

## Search by intent

The package table routes when you know *which package*; the construct index
routes when you know *what you want done* but not what it is called. One
generated file per package lives in
[references/constructs/](./references/constructs/) — every export in the kit,
with its kind, TSDoc purpose, and intent keywords ("validate NTIA compliance",
"run a workspace binary", "build a GFM table node").

Before concluding the kit lacks a capability, grep the index by intent words:

```bash
grep -ri "table" plugins/claude-code/skills/effected-packages/references/constructs/
grep -ri "oidc\|identity token" plugins/claude-code/skills/effected-packages/references/constructs/
```

(In a consumer repo the plugin's install path replaces `plugin/`.) Rows whose
last column names an `implements` / `implemented by` pair are the kit's
deliberate contract↔implementation splits — the capability lives in a
different package than its contract. A no-match result means "not found in
this index" — check the package's reference and source before concluding the
kit lacks the capability. That is still far stronger evidence than never
grepping at all: hand-rolling a capability without an intent grep is how every
documented miss happened.

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
- **`@effected/workspaces` publishability has NO ambient default.** No
  composite (`Workspaces.layer`, `layerWithGit`, …) provides
  `PublishabilityDetector`, and none *requires* it either — nothing inside a
  composite asks a publishability question, so its `R` stays `FileSystem |
  Path`. The requirement surfaces only in the `R` of an operation that does
  ask (`VersioningStrategy.detect`, e.g.): a program that asks and never wires
  one fails to compile there, and a program that never asks never needs a
  policy. Wire one explicitly where needed — `Layer.mergeAll(Workspaces.layer(),
  PublishabilityDetector.layerNpm)` for npm semantics, `layerNone`, or your own
  policy. The composite used to bake npm semantics in, and because
  `Layer.mergeAll` is last-wins, the natural spelling of an override
  (`Layer.mergeAll(mine, Workspaces.layer())`) silently lost to it. Each
  shipped policy is also reachable as a **value** (`PublishabilityDetector.npm`),
  so a policy that wraps npm semantics does not have to re-enter the tag it is
  replacing.

## Local-build dogfood state

**Whether a given package has published is a check, not a roster to
memorize** — `npm view @effected/<name> version` answers it directly, and a
package that has not yet published is consumed from the local checkout during
a dogfood loop instead of from the registry.

Releases are changeset-driven: CI builds the appropriate changesets and
releases the packages they name. That may be the whole kit on a prerelease advance
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

- Every package publishes a flat CODE entrypoint (`@effected/<pkg>`), and a
  few add a code subpath that the main entry never re-exports:
  `@effected/workspaces/node-sync` (Node bindings for the synchronous escape
  hatch), `@effected/workspaces/testing` (the repo-shape checks),
  `@effected/cli/testing` (`CliTest`), `@effected/mcp/testing` (`McpHarness`,
  `McpProbe` and friends) and `@effected/schema-org/validate` (offline
  conformance validation). Everywhere else, no code subpath imports (each
  package also exports its own `./package.json` for tooling; that is
  metadata, not API).
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

## Related skills

`effect-v4-module-index` routes Effect core; this skill routes the kit. Check
core first — the kit deliberately requires core contracts (`FileSystem`,
`ChildProcessSpawner`) rather than re-declaring them. `effect-v4-cli` and
`effect-v4-mcp` teach the CLI and MCP boundaries in depth; `design-patterns`
teaches the carrier pattern shared between a CLI and an MCP front end that
`@effected/engine` supports.

**Construct-level coverage — does every export get named somewhere in
`skills/` — is checked, not maintained by hand here.**
`plugins/claude-code/__test__/construct-index.bats` regenerates the construct index from
every package's api-extractor doc model and fails on any drift from the
committed tables under `references/constructs/`, and its strict mode requires
an intent annotation for every value-kind export. The generated tables, not
this file's prose, are the source of truth for whether a given export is
covered — a hand-maintained claim of completeness drifts the same way this
file's own stale reference-file count once did. The maintenance loop lives in
the repo's `constructs` skill.
