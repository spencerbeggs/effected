# Module

* [@effected/cli](cli.md) - The presentation boundary of an effect/cli program — audience, colour, theme, messages, logging, failure reporting and schema-issue renderers in a React-free root, with interactive Ink screens behind ./ui and their test harness behind ./ui/testing.
* [@effected/commands](commands.md) - The kit's tool-and-output layer over core's subprocess contract — structured running and CLI tool discovery.
* [@effected/engine](engine.md) - The platform-free primitives a carrier-pattern tool's own engine package shares across its front ends — distribution stamping, remediation shape, and launch-context resolution.
* [@effected/env](env.md) - The boundary package that detects who is running a program and in what terminal — agent, CI, colour level, hyperlink support and width — through Config, with no node imports and no import-time reads.
* [@effected/github](github.md) - The kit's typed GitHub REST and GraphQL API layer, owning the octokit runtime.
* [@effected/github-commands](github-commands.md) - The GitHub Actions workflow-command grammar as pure functions: render a command, and neutralize text so the runner cannot read it as one.
* [@effected/github-references](github-references.md) - GitHub's issue-reference grammar as pure functions, extracted from @effected/github.
* [@effected/images](images.md) - Image facts read from bytes with one typed parse failure, plus a generated-image cache keyed by a Schema-encoded parameter object.
* [@effected/jsonl](jsonl.md) - Append-only, schema-validated JSONL journals exposed as a definable Effect service — the file as a live object, not a text format.
* [@effected/jwt](jwt.md) - Signed-token primitives (JWS, JWT, JWK, JWKS) over WebCrypto that run anywhere WebCrypto does, including Cloudflare workerd.
* [@effected/lsp](lsp.md) - Language Server Protocol base-protocol framing as pure functions (Content-Length encode, an incremental byte decoder and a Stream transform), an LspStdio launcher that keeps stdout the wire and exits with the specification's code, plus a ./testing subpath whose LspProbe proves a Language Server bin boots and whose LspProcess drives one frame by frame — the LSP twins of McpStdio, McpProbe and McpProcess.
* [@effected/markdown](markdown.md) - CommonMark 0.31.2 + GFM as pure Effect Schema classes; parse, edit, format, modify and project markdown documents.
* [@effected/mcp](mcp.md) - The boundary-tier MCP front end — stdio server wiring with a JSON-RPC stdin guard, tool-failure shaping, JSON-schema input walkers for Tool.dynamic tools, and strict-by-default toolkit registration — plus an in-process/spawned testing subpath.
* [@effected/memfs](memfs.md) - An in-memory implementation of core Effect's FileSystem service — an isolated virtual POSIX volume the kit's tests use as their filesystem double.
* [@effected/schema-org](schema-org.md) - The schema.org vocabulary as pure Effect Schema classes, a JsonLdDocument graph assembler with a script-safe serializer, and offline conformance validation over the vendored vocabulary.
* [@effected/schemastore](schemastore.md) - Builds, versions, validates and lints SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources, over core's generation pipeline.
* [@effected/schemastore-cli](schemastore-cli.md) - The companion command to @effected/schemastore: loads a schemastore.config.ts, builds or checks every declared schema and catalog entry under a per-schema published flag and a drift policy, validates a payload against a published document, and reports to a terminal, JSON or a GitHub step summary; also the home of the kit's two shipped engines, AjvValidator (SchemaValidator) and AjvInstanceValidator (InstanceValidator).
* [@effected/spdx](spdx.md) - SPDX license identifiers, exceptions and license expressions modeled as pure Effect Schema classes, owning the grammar rather than depending on a parser package.
* [@effected/templates](templates.md) - A managed-section mechanism — delimited BEGIN/END blocks a tool owns inside a file the user otherwise owns.
* [@effected/workspaces: monorepo tooling](workspaces.md) - The integrated-tier package that finds a workspace root, enumerates its packages, walks the dependency graph, detects the package manager, assembles pnpm catalogs, checks peer dependencies, and reads git-scoped snapshots.
* [@effected/yaml](yaml.md) - Pure-tier YAML 1.2 parsing, editing, formatting and linting as Effect schemas, with a vendored engine and full per-node comment fidelity.
* [ai-plugin](ai-plugin.md) - The "effected" agent plugin: one pluginfinity source under plugin/ — skills, three specialist agents and a SessionStart briefing — built into committed Claude Code and GitHub Copilot plugins.
* [app](app.md) - The thin composition layer wiring xdg, config-file and store into an application control plane -- owns no domain logic, defines no service or error of its own, and re-exports nothing from the packages beneath it.
* [config-file](config-file.md) - Composable config-file loading built around a codec × resolver × strategy pipeline, carrying all four config codecs.
* [git](git.md) - Typed git for the kit — a read tier over a repository's state and a clearly-marked mutating tier, plus a pure git-config document model.
* [github-actions](github-actions.md) - The GitHub Actions runner runtime — environment, inputs/outputs/state, workflow commands, storage, reporting and the sbom attestation seam.
* [glob](glob.md) - Full-fidelity glob matching as pure string-to-predicate Effect Schema compilation, vendoring the complete minimatch dialect.
* [jsonc](jsonc.md) - Zero-dependency JSONC parsing, editing and formatting as Effect Schema classes.
* [lockfiles](lockfiles.md) - Pure lockfile parsing for bun, npm, pnpm and yarn Berry, normalized into one unified model, plus pure integrity checking.
* [npm](npm.md) - The dependency-resolution contracts a manifest library defines but cannot implement, the npm vocabulary shared across the kit, and the registry/tarball/publish services that replace a shelled-out npm CLI.
* [package-json](package-json.md) - package.json parsing, editing, validation and file IO as Effect schemas — the kit's boundary-tier manifest library and its reference for pure/IO separation.
* [pnpm-plugin-effect](pnpm-plugin-effect.md) - The kit's companion pnpm config dependency — publishes the effect and effected catalogs that pin the whole ecosystem's versions.
* [runtimes](runtimes.md) - Resolves semver-compatible Node.js, Bun and Deno versions from live release feeds, with a bundled offline snapshot as fallback.
* [sbom](sbom.md) - The software-supply-chain artifact half of attestation — a CycloneDX 1.6 SBOM, the NTIA report, SLSA provenance and Sigstore DSSE signing.
* [scratchpad](scratchpad.md) - A committed but never-published pnpm workspace member that lets agents write typed probes fast — the evidence ladder's rung 3 tooled instead of hand-rolled.
* [semver](semver.md) - Strict SemVer 2.0.0 versions, ranges and comparators as Effect Schema classes — the kit's DX exemplar.
* [store](store.md) - Durable local state for Effect v4 — a schema-versioned migrated SqlClient and a TTL key-value cache, sharing one migration-ledger engine over a single SQLite driver dependency.
* [toml](toml.md) - TOML 1.1.0 parsing, editing and formatting as pure Effect Schema classes on a from-scratch engine.
* [tsconfig-json](tsconfig-json.md) - Read, decode, validate, resolve and construct tsconfig.json files with zero typescript imports.
* [walker](walker.md) - Path traversal as a small, testable library -- upward ascent to a marker via an absorbing search, and downward glob-file expansion with a fail-typed error posture, sharing no state and no error contract between the two directions.
* [website](website.md) - The RSPress docs site, publishing per-package API reference generated from each package's api-extractor model under lib/models/.
* [workspace](workspace.md) - The monorepo root — layout, build pipeline, dependency resolution and vendored source.
* [xdg](xdg.md) - XDG Base Directory resolution -- turning the environment into namespaced, precedence-ordered application directories and a config-file resolver chain, with no database and no runtime dependencies.
