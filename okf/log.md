# Log

## 2026-11-28

* Updated @effected/testing
* Updated The vitest suite splits into a fast tier with coverage and slow, hostile and full tiers run beside it
* Updated Never hand-edit the construct index — regenerate it
* Updated ai-plugin
* Updated construct-annotations.json
* Updated workspace
* Updated A root workspace:* devDependency puts its whole closure into turbo's global hash

## 2026-11-27

* Updated @effected/memfs
* Updated An upgrade-ledger entry is one change, selected by the versions a consumer's upgrade crosses
* Updated walker
* Updated @effected/cli-kit
* Updated @effected/yaml

## 2026-11-26

* Updated @effected/lsp
* Updated store
* Updated @effected/memfs
* Updated walker
* Updated @effected/cli-kit
* Updated A plugin skill is a lean index over references
* Updated Advance the effect pin
* Updated An upgrade-ledger entry is one change, selected by the versions a consumer's upgrade crosses
* Updated Consumer upgrades run one fixed plugin process over an append-only ledger of per-change entries
* Updated Consumer-facing text states current Effect behaviour, never versions
* Updated Release a plugin
* Updated The carrier libraries take -kit names, with no shim
* Updated ai-plugin

## 2026-11-25

* Updated @effected/markdown-lint
* Added @effected/testing
* Updated @effected/markdown
* Updated @effected/shell
* Added Sampling markdown-lint's corpus cut its local file time from 1,675 s to 160 s, short of the 240 s CI gate's proportion
* Updated Testing standards
* Updated The vitest suite splits into a fast tier with coverage and slow, hostile and full tiers run beside it
* Updated lockfiles
* Updated workspace
* Updated glob
* Updated "Wait for the kit" leaves raw spawns and duplicated regex behind
* Updated @effect/platform-node declares redis as a required peer, so every kit package on it brings redis along
* Updated @effect/platform-node is a required peer in exactly one package
* Updated @effected/bundler
* Updated @effected/changesets
* Updated @effected/cli
* Updated @effected/cli-kit
* Updated @effected/cli-kit depends on @effected/kit as a regular dependency, for distribution
* Updated @effected/cli-kit grows a presentation layer and interactive UI
* Updated @effected/cli-kit is not a CLI framework
* Updated @effected/commands
* Updated @effected/commands does not supervise or archive processes
* Updated @effected/crypto
* Updated @effected/engine
* Updated @effected/env
* Updated @effected/env is its own boundary package, a required peer of cli
* Updated @effected/files
* Updated @effected/github
* Updated @effected/github App authentication
* Updated @effected/github GraphQL
* Updated @effected/github REST client
* Updated @effected/github does not own every GraphQL document
* Updated @effected/github errors and retry
* Updated @effected/github owns the octokit runtime
* Updated @effected/github resource services
* Updated @effected/github-commands
* Updated @effected/github-references
* Updated @effected/images
* Updated @effected/jsonl
* Updated @effected/jsonl journal service
* Updated @effected/jsonl read surfaces
* Updated @effected/jwt
* Updated @effected/kit
* Updated @effected/lsp
* Updated @effected/manifest
* Updated @effected/markdown MDX vocabulary
* Updated @effected/markdown frontmatter
* Updated @effected/mcp
* Updated @effected/mcp-kit
* Updated @effected/mcp-kit ships StdioCapture behind a Node-only ./node subpath, licensed for two node: imports
* Updated @effected/memfs
* Updated @effected/oidc
* Updated @effected/oidc is a thin package that owns the IdentityToken contract
* Updated @effected/plugin
* Updated @effected/s3
* Updated @effected/schema-org
* Updated @effected/schema-org declines both available @effected edges
* Updated @effected/schema-org validate entrypoint
* Updated @effected/schemastore
* Updated @effected/semver stays independent of core SemVer and SemVerRange
* Updated @effected/source
* Updated @effected/spdx
* Updated @effected/templates
* Updated @effected/vfs is deferred until a second consumer materializes
* Updated @effected/webhooks
* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces dependency graph
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces duplicate-copy checking
* Updated @effected/workspaces peer-dependency checking
* Updated @effected/workspaces release surface
* Updated @effected/workspaces snapshots
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/workspaces: monorepo tooling
* Updated @effected/yaml
* Updated @effected/yaml comment model
* Updated @effected/yaml lint system
* Updated @effected/yaml stringify options
* Updated A CLAUDE.md that reads confidently can be citing a tree that no longer exists
* Updated A Git config read with no scope is the merged view, not the checkout's own
* Updated A GitCommand constructor carries no cwd and no environment
* Updated A PR's check runs post to the merge ref, not the head SHA
* Updated A bare-major version key enumerates ahead of every dotted one
* Updated A block-mapping key longer than 1024 rendered characters spills to explicit-key form
* Updated A branch build's dist/ carries the previous release's version
* Updated A capability recon pass at package level misses constructs the kit already ships
* Updated A clean issue tracker on a scaffold is not evidence it works
* Updated A config from another schemastore version fails the CLI and only warns the MCP
* Updated A cursor-less jsonl query reads the whole file into memory
* Updated A declared-family key must be a name ajv can register, and its payload cannot carry an $id
* Updated A degraded build-time decode failure reports a truthful-sounding empty result
* Updated A flaky jsonl watcher is probably an arming-order window, not an unreliable platform watch
* Updated A generator's data input is a committed file, not a submodule
* Updated A green typecheck after linking an unreleased kit build hides a second effect instance
* Updated A language-less Code node stringifies as an indented block, not a fenced one
* Updated A live view is a scoped drain of runs, hosted or owned, with no input and the mount permit per run
* Updated A lockfile is a YAML stream, not always one document
* Updated A long-lived MCP server does not see an edit to an imported native module until it restarts
* Updated A macOS Actions runner's npm cache is partly root-owned
* Updated A mechanically repaired fixture set goes green while describing a state GitHub cannot produce
* Updated A missing PublishabilityDetector fails far from where it was wired
* Updated A network-touching Git member's worst-case latency is a multiple of GIT_TIMEOUT
* Updated A new stringify option added to one adapter silently no-ops on the other two
* Updated A package manifest cannot say who supplied it, who assembled the BOM, or when
* Updated A package that commits fixtures commits a provenance README beside them
* Updated A package that names its own root types once showed one warning or none, until the bundler resolved the self-reference to declarations
* Updated A physical ascend ceiling is a separate static taking an Option, not a realpath mode of stopAt
* Updated A plain pnpm install can silently strip platform binaries from the lockfile
* Updated A plausible schema.org property on the wrong type serializes cleanly and gets silently ignored
* Updated A plugin skill is a lean index over references
* Updated A public lookup that can miss returns Option, never T | undefined
* Updated A public name must not collide with an effect root export
* Updated A red markdown tripwire test may mean you fixed something, not broke it
* Updated A renamed field typed never turns a silent conditional-spread drop into a compile error
* Updated A repo-local protocol.file.allow does not reach a submodule add's internal clone
* Updated A root workspace:* devDependency puts its whole closure into turbo's global hash
* Updated A schema.org property gets one fixed arity, chosen toward many when uncertain
* Updated A schemastore outputDir is never exclusively the command's
* Updated A scope-qualified filter, a version-only sort, and a plain Redacted all fail silently
* Updated A second published entrypoint is a measured cost, not a convenience
* Updated A single embedded NUL byte makes grep silently skip a text file
* Updated A subpath entrypoint named after its own concept module fails at two layers
* Updated A test needing FileSystem uses memfs, never a hand-rolled layerNoop stub
* Updated A tool installed only globally also probes as local, because the package manager's exec falls through to PATH
* Updated A turbo cache hit reads exactly like a fresh build in the log
* Updated A validation failure on an absent input silently resolves to the default
* Updated A vitest positional filter is a substring match, and a run from inside a package never loads the root config
* Updated A watched build does not rebuild for inputs outside the package
* Updated A yarn Berry lockfile has no devDependencies section
* Updated A zero-width space never stopped the Actions runner reading a workflow command
* Updated ActionEnvironment is the only reader of ambient process state
* Updated Add a kit package
* Updated Add a workspace package
* Updated Advance the effect pin
* Updated After a workspace package is renamed, the next pnpm run installs before it runs the script
* Updated Agents never run pnpm:up, pnpm:preview, or pnpm:export
* Updated An `as never` cast and a second process.env read both compile clean and fail at runtime
* Updated An unprotected environment runs fork code with secrets
* Updated An unsatisfiable effect peer installs clean and fails somewhere else
* Updated An upgrade-ledger entry is one change, selected by the versions a consumer's upgrade crosses
* Updated App auth, OIDC verify and the token store land in @effected/github
* Updated AppDirs.segment does not refuse Windows trailing dots or device names
* Updated Atomic writes live in their own package, @effected/files, not in @effected/kit or @effected/store
* Updated Author the plugin once in plugin/, never edit its builds
* Updated Azure is confined to three modules, not two
* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated Build logs are two append-only journals at the workspace root, derived from a cached per-package issues.json
* Updated Build through turbo
* Updated Bun's package-tuple integrity position is assumed, not documented
* Updated CI's Run Tests step took 21 minutes, half of the file time in five files
* Updated Calling Store.layerSqlite inline at two provide sites opens the database twice
* Updated Calling ajv-formats' default import is a TS2349, and the one-hop `.default` is not a bug
* Updated Carrier-only bins are recommended; shared bins are a supported choice
* Updated Change the Claude Code plugin first, then port to Copilot
* Updated CliLinks finds the editor directory with its own bounded ascent
* Updated CliLinks finds the project root with @effected/walker
* Updated CliLogger honours LogToStderr only as a force-all override
* Updated Climb the evidence ladder in order — renames, then source, then a probe
* Updated Close a catalog membership gap
* Updated Companion package
* Updated ConfigCodec is exempt from the sync primitive policy
* Updated ConstantTime.equal is best-effort constant time
* Updated Consumer upgrades run one fixed plugin process over an append-only ledger of per-change entries
* Updated Consumer-facing text states current Effect behaviour, never versions
* Updated Consumers see one catalog, effected, folded by the plugin's hook from split declarations
* Updated Contract inversion is the default answer to a tier-dragging edge
* Updated Converting doubles and the test runner together rewrites the gate alongside what it gates
* Updated CorepackIntegrityHash is consumed by identity, and only a runtime identity assertion can see a re-fork
* Updated D10: McpToolAudit enforces object-rooted outputs by default
* Updated D1: @effected/kit exists and holds Distribution, Remediation and LaunchContext
* Updated D3: CliLogger's stderrFrom default flips to All
* Updated D4: okfit and vitest-agent are registered as consumers before extraction
* Updated D5: the layering, packed-install and boundary checks live in @effected/workspaces/testing
* Updated D6: CLI and MCP knowledge stays in separate skills, linked from design-patterns
* Updated D7: usageExitCode defaults to 64 (BSD EX_USAGE)
* Updated D9: CliTest uses core ChildProcess, with no peer on @effected/commands
* Updated D: strict MCP input default for Claude Code
* Updated Decided against: a shared @effected/errors package
* Updated Decoding a JsonLdDocument silently drops the additional catch-all
* Updated Dependency policy: R1-R4
* Updated Design a GitHub Action repository on the kit
* Updated Each format package keeps its own options type
* Updated Each runtimes resolver exposes three lazy layer constants, not one configurable layer
* Updated Enable fork pull-request review on a repository
* Updated Error handling standards
* Updated Every commit follows the conventional-commit and DCO contract
* Updated Every default reference time comes from Clock, never new Date()
* Updated Every git constructor and error path carries the redaction mask
* Updated Every package carries the same manifest shape and file set
* Updated Explicit markdownlint-cli2 path arguments do not narrow the scan
* Updated FORCE_COLOR is honoured, with Node's getColorDepth precedence
* Updated Format entry points never return Effect
* Updated Format-package convention
* Updated Format-package naming is `*Format`, not `*Unvalidated`
* Updated Generated objects are closed by default, departing from core's open default
* Updated Ghost workspace
* Updated Git error classification uses unanchored substring matching on stderr
* Updated Git failure classification happens once, in one private function
* Updated Git.configSet cannot write a value that begins with a dash
* Updated GitHubClient keeps only the authenticated REST reads Bun and Deno need
* Updated Image formats are read by in-house header readers
* Updated Ink delivers every key in one stdin read before React re-renders
* Updated Input-hardening standards
* Updated Keep the tree resolved to one effect copy
* Updated Keyed operations come from core Mac, payload digests from core Digest, both required in R
* Updated Library tier (pure / boundary / integrated)
* Updated Link a consumer to an unreleased kit build
* Updated Markdown dialects are a closed set with no public extension API
* Updated Markdown editing is offset-splice, not a lossless CST
* Updated MarkdownFormat.modify refuses frontmatter, list items, table rows and the root
* Updated Module layout is module-per-concept, not kind-based folders
* Updated Never hand-edit the construct index — regenerate it
* Updated Never undo unexpected working-tree changes with git checkout, restore, or stash
* Updated Never write under .repos/
* Updated New ae-forgotten-export errors after a bundler bump are TypeScript 7.1 emitting typeof a module local, not a bundler regression
* Updated No @effected/* package imports typescript
* Updated No SchemaVersioning.plan surface
* Updated No bin on the library — the executable lives in the effected tool
* Updated No layerDefault on SchemaValidator or SchemaFile
* Updated No shipped templates/ directory
* Updated NpmRegistry applies none of the npmrc proxy or TLS settings
* Updated NpmRegistry does not cache repeated packument reads
* Updated Observability standards
* Updated One GitHub Actions OIDC claims class, ActionsOidcClaims in @effected/github
* Updated One tracking package versions both plugin builds
* Updated Only ./ui may bind Node's process streams, and only in three named files
* Updated Only @effected/bundler imports typescript, and only it and the tool's packages peer it
* Updated Only entrypoint files re-export; never a barrel or a namespace object
* Updated Only package-json needs a tolerant formatting seam
* Updated Package-manager support window
* Updated PackageManager's version and integrity fields ARE the schemas their owning packages export
* Updated PackedInstall packs the prod npm directory by default
* Updated Peer-dependency discipline
* Updated PeerCheck cannot answer yarn
* Updated Pin heavy-dependency confinement with a reachability suite that has a positive control
* Updated Plan a surface's first consumer port as a design round
* Updated Provenance lives in the engine state, and is never hardcoded
* Updated Publish a snapshot
* Updated Raw S3 objects get their own boundary package, with a ListObjectsV2 reader that fails a wrong root
* Updated React 19's development reconciler leaked user-timing entries on every render, until react-reconciler 0.34
* Updated Read publishability from publishConfig.access, never from private
* Updated Regenerate the GitHub Action template repository
* Updated Regenerate the runtimes bundled offline defaults
* Updated Regenerate the vendored SPDX datasets
* Updated Regenerate the vendored schema.org vocabulary table
* Updated Release a plugin
* Updated ReleaseTag defaults to strict SemVer with no version prefix
* Updated Releases are changeset-driven and scope-agnostic
* Updated Require the consolidated core's contract in R; never re-implement or re-declare it
* Updated Resetting a branch to its pull request's base closes that pull request
* Updated Run.collect drains stdout, stderr and the exit code concurrently
* Updated Run.text trims output that depends on fixed columns
* Updated RunOnce trusts a done marker only from an owner it observed, and breaks a lock through per-contender tickets and a rename-based compare-and-delete
* Updated Running the bundler script directly fakes a clean build gate
* Updated Schema standards
* Updated SchemaFile's write-if-changed compares parsed content, not bytes
* Updated SchemaStore's own coverage tool is not reimplemented
* Updated Schemastore retiers from boundary to integrated for a direct ajv dependency
* Updated Secret.ts is the only place a Redacted becomes a string
* Updated SectionId keys render into markers exactly as constructed, with no normalization
* Updated Services and layers standards
* Updated Shell syntax analysis is its own pure package, @effected/shell, not a commands subpath or core CommandLine
* Updated State which count moved and why, whenever a gate's number changes
* Updated Store is built on effect's own SQL core and @effect/sql-sqlite-node
* Updated Store is named for its primitive, not its backend
* Updated Store.migrateOnce keeps a process-global registry of plain Promises
* Updated Strict MCP input is reported by core; McpToolkit appends the accepted params instead of pre-checking
* Updated Sync the vendored repos
* Updated Sync-primitive policy
* Updated The Catalog Sync check goes RED when it found and fixed drift
* Updated The Draft-07 meta-schema constant keeps its trailing hash
* Updated The Ink layer is a ./ui subpath of cli, with ink and react as optional peers
* Updated The JWT algorithm comes from the key, never the token header
* Updated The MDX brace escape is presence-keyed, never a stringify option
* Updated The NTIA minimum-elements report is a report, not a gate
* Updated The Node schedule is keyed by release line, not by major
* Updated The ajv engine lives in the effected tool, and the library returns to boundary tier
* Updated The ascend ceiling compares resolved paths and rejects a relative stopAt as a defect
* Updated The assembly module is named StoreDocument, not SchemaDocument
* Updated The audience flag is four shared root flags resolved into env's Audience
* Updated The blob transport is internal and HttpClient-based
* Updated The build artifacts: dist/prod, targets.json, issues.json and the journals
* Updated The build task hashes CI and GITHUB_ACTIONS, not pending changesets
* Updated The bundle manifest is its own pure package, @effected/manifest, emitted as a platform-neutral bundle.json
* Updated The carrier libraries take -kit names, with no shim
* Updated The catalog sync moved the effect catalog onto Effect 4.1 under a kit built on 4.0
* Updated The catalog: and workspace: protocols are shared, so their contracts stay in @effected/npm
* Updated The catalog:sync / catalog:check CLI
* Updated The cli package owns its display-width function
* Updated The cli renderers have no JSON output
* Updated The cli root boundary is a module-graph walk, not a per-file scan
* Updated The cli root stays boundary, and ./ui is integrated only for consumers who opt in
* Updated The committed SPDX license catalog
* Updated The committed schema.org vocabulary document
* Updated The config companion is named @effected/plugin, not built yet
* Updated The config-driven GitHub auth layer reads Config, never process.env
* Updated The document IR is plain frozen data, not Schema classes
* Updated The effect catalog holds the Effect family to one minor with tilde ranges
* Updated The effect catalog locks every entry to an exact version, held by overrides
* Updated The effect catalog takes caret ranges on the stable line
* Updated The effect family is pinned graph-wide by overrides derived from the catalog
* Updated The effected build commands: package build, action build and action init
* Updated The effected catalog holds next-release versions, and the publish order follows
* Updated The effected catalog literal
* Updated The effected schema command writes tab-indented, fully expanded JSON only
* Updated The effected schema commands: build, check and validate
* Updated The fidelity obligation and how it is tested
* Updated The git ssh BatchMode pin is appended to what git would have used, and declines rather than substitutes
* Updated The github-split (program name)
* Updated The image cache backend is a structural port, not a store dependency
* Updated The importer-name map carries names only
* Updated The jsonl Journal service is a per-registry factory, not a generic key
* Updated The kit builds itself with the bundler running from source under tsx
* Updated The kit has one build target, and workspace links point at package roots
* Updated The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location
* Updated The kit's layering check forbids runtime edges only
* Updated The kit's markdown lint reads markdownlint's own configuration model, not markdownlint-cli2's, and stays in @effected/markdown-lint for now
* Updated The libsodium sealed box stays in @effected/github until a second consumer appears
* Updated The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook
* Updated The live view never calls Ink's clear(); a new run re-renders in place or remounts
* Updated The live view's tick is a scoped Effect schedule, and its frame index comes from Clock
* Updated The markdown canonical form is a published commitment — a row that moves is a breaking change
* Updated The markdownlint-compatible lint shape is its own pure package; @effected/markdown gains only the callback visitor
* Updated The monorepo holds one tool, effected, beside its libraries
* Updated The npm and bun resolution walk is deepest-first
* Updated The npm tier guardrail — a non-core runtime dependency in a service escalates the whole package
* Updated The numeric-enum codec is data, not a typescript dependency
* Updated The package-json decode-free text path
* Updated The package-json entry-point resolver
* Updated The package-json exports resolver
* Updated The plugin declares a second consumer-visible catalog, effected:build, for the kit's build chain
* Updated The plugin declares one catalog, effected, and pins only the Effect family by include pattern
* Updated The plugin's catalog paired 4.0.3 satellites with core effect 4.0.2
* Updated The pnpm root importer is not represented as a package row
* Updated The release index is Ref-backed with a single atomic load
* Updated The required Claude Code Review check fails on an empty-body approval
* Updated The root tsconfig's skipLibCheck override exists only to work around one vitest .d.ts
* Updated The runtimes bundled offline defaults
* Updated The schemastore commands live in the effected tool, and the companion package is removed
* Updated The sealed box's primitives are copied from noble into @effected/github, with no third-party crypto dependency
* Updated The sync form is named `*Result`, never `*Sync`
* Updated The typechecker: tsc, not tsgo
* Updated The ui declarations reference the root's types by the package's own name
* Updated The validation gate ships a real ajv engine, closed by default
* Updated The workflow-command grammar left github-actions for its own pure package
* Updated The yaml lint system stays inside the pure tier
* Updated There is no Effect v3 catalog and no camelCase catalog alias
* Updated There is no cross-run artifact lookup
* Updated Treat line endings as a first-class invariant in any file-rewriting code
* Updated Two prompt engines raise one Cancelled error
* Updated Under the no-op hooks layer, a hook-injected catalog's range bump between two refs is invisible to a snapshot diff
* Updated Vendored Effect is pinned to the lockfile's tag, not main
* Updated Vendored repos are empty on a fresh clone
* Updated Vendored repos manifest
* Updated While a live view is mounted, kit logs go through Ink's own stdout and stderr writers
* Updated WorkspacesSync is a `*Sync` escape hatch, not a `*Result` pure form
* Updated Write changesets once, at branch finalization, never per round
* Updated Writing frontmatter re-serializes the whole block and can drop untracked data
* Updated Yarn carries no resolved peer edges
* Updated actions-attestation
* Updated actions-reporting
* Updated actions-runtime
* Updated actions-step-log
* Updated actions-storage
* Updated ae-forgotten-export on _base looks like a real export bug; it is a synthesized, un-nameable symbol
* Updated ai-plugin
* Updated app
* Updated app is a composition layer, not an umbrella package
* Updated app's test layer lives behind ./testing, with memfs an optional peer
* Updated bun
* Updated bun below 1.4.4 hoists api-extractor's typescript over the tool's peer
* Updated catalog:build is missing from pnpm-workspace.yaml because it is injected
* Updated claude-code-marketplace-manager
* Updated cli files the Command handler-accessor gap upstream rather than shimming it
* Updated cli sets the exit code through core's own Runtime markers
* Updated commands' workspaces edge inverts rather than dragging four packages integrated
* Updated config-file
* Updated config-file has no file-watching capability
* Updated config-file's codecs are free-standing named exports, never a namespace object
* Updated construct-annotations.json
* Updated effected
* Updated effected.toml is the only build config, and code enters through two data keys
* Updated effected.toml: the build config's tables, defaults and discovery
* Updated git
* Updated git log --follow is not the unfollowed walk plus more
* Updated github's github-references compat re-export is droppable, not breaking
* Updated github-actions
* Updated github-actions errors are per-reason tagged unions, not one class with a reason field
* Updated github-references was extracted from github for install weight
* Updated glob does not bound total matching work on hostile patterns
* Updated glob is a full-fidelity vendored port, not a minimal runtime dependency
* Updated jsonc
* Updated jsonc's engine/facade split is a cycle firewall
* Updated jsonl terminal and quiescent semantics are journal-wide, not per-scope
* Updated jsonl's watch is a service in R that succeeds only once registered, with a Node backend behind ./node
* Updated lint-staged normalizes every committed shell script back to 644
* Updated memfs takes zero @effected/* edges, ever
* Updated memfs's volume is invisible to anything that does not ask for the FileSystem service
* Updated npm
* Updated npm 12's pack --json is an object keyed by name, not an array
* Updated npm and bun rows never populate unresolvedEdges
* Updated npm names its publish auth path only below its default log level
* Updated npm run silently claims flags meant for the script
* Updated package-json
* Updated package-json delegates SPDX license validity to @effected/spdx
* Updated package-json reads the same document through five tolerance tiers
* Updated pnpm
* Updated pnpm 12's placeholder bin dies as a SyntaxError when shimmed under node
* Updated pnpm add --config silently strips integrity hashes from every config dependency
* Updated pnpm peers check is expected to report exactly one occupant
* Updated pnpm-plugin-effected
* Updated pnpm-plugin-effected is deliberately absent from its own effected catalog
* Updated pnpm:export keeps a catalog the plugin no longer declares
* Updated primaryLicense returns none for an AND expression rather than guessing a term
* Updated runtimes
* Updated runtimes reads GitHub over core HttpClient, never Octokit
* Updated runtimes' error ladder keeps four distinctions the pipeline must not collapse
* Updated savvy-web/systems
* Updated sbom
* Updated sbom owns its own CycloneDX emitter, declining the object-model library
* Updated scratchpad
* Updated semver
* Updated semver's parse and intersect Results are the primitive
* Updated silk-release-action
* Updated silk-router-action
* Updated silk-runtime-action
* Updated silk-sync-action
* Updated silk-update-action
* Updated spencerbeggs/okfit
* Updated spencerbeggs/reposets
* Updated spencerbeggs/tsdoctor
* Updated spencerbeggs/vitest-agent
* Updated std-osc8's pure core is ported into env, not wrapped
* Updated store
* Updated templates owns the mechanism, never the content
* Updated toml
* Updated toml is a full-parity package built from scratch
* Updated tsconfig-json
* Updated tsconfig-json enum mapping tables
* Updated tsconfig-json is one package, not a pure-schema/boundary-IO split
* Updated walker
* Updated website
* Updated xdg
* Updated xdg does not depend on store
* Updated xdg stays independent of core UserDirectories

## 2026-11-24

* Updated @effected/markdown-lint
* Updated @effected/markdown
* Updated The vitest suite splits into a fast tier with coverage and a slow tier run beside it
* Updated Every package carries the same manifest shape and file set
* Added The kit's markdown lint reads markdownlint's own configuration model, not markdownlint-cli2's, and stays in @effected/markdown-lint for now
* Updated The markdownlint-compatible lint shape is its own pure package; @effected/markdown gains only the callback visitor
* Updated effected
* Updated workspace
* Updated @effected/changesets
* Updated Keyed operations come from core Mac, payload digests from core Digest, both required in R
* Updated Raw S3 objects get their own boundary package, with a ListObjectsV2 reader that fails a wrong root
* Updated actions-storage
* Updated glob

## 2026-11-23

* Updated @effected/markdown-lint

## 2026-11-22

* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/jsonl
* Updated @effected/jwt
* Updated @effected/crypto
* Updated @effected/s3
* Updated Keyed operations come from core Mac, payload digests from core Digest, both required in R
* Updated Raw S3 objects get their own boundary package, with a ListObjectsV2 reader that fails a wrong root
* Updated actions-storage
* Updated github-actions

## 2026-11-21

* Updated The effected build commands: package build, action build and action init
* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated git
* Updated actions-step-log
* Updated github-actions
* Updated The git ssh BatchMode pin is appended to what git would have used, and declines rather than substitutes
* Updated actions-runtime
* Updated @effected/mcp-kit
* Updated @effected/source
* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces: monorepo tooling
* Updated Testing standards
* Added A root workspace:* devDependency puts its whole closure into turbo's global hash
* Added CI's Run Tests step took 21 minutes, half of the file time in five files
* Added The build task hashes CI and GITHUB_ACTIONS, not pending changesets
* Added The vitest suite splits into a fast tier with coverage and a slow tier run beside it
* Updated workspace
* Updated @effected/github App authentication
* Updated The catalog:sync / catalog:check CLI

## 2026-11-20

* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated The effected build commands: package build, action build and action init
* Updated effected.toml: the build config's tables, defaults and discovery
* Updated A GitCommand constructor carries no cwd and no environment
* Updated A network-touching Git member's worst-case latency is a multiple of GIT_TIMEOUT
* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated The git ssh BatchMode pin is appended to what git would have used, and declines rather than substitutes
* Updated actions-runtime
* Added actions-step-log
* Updated git
* Updated github-actions

## 2026-11-19

* Updated @effected/engine
* Updated The effected build commands: package build, action build and action init

## 2026-11-18

* Updated @effected/engine
* Added A watched build does not rebuild for inputs outside the package
* Updated The effected build commands: package build, action build and action init

## 2026-11-16

* Updated @effected/crypto
* Updated @effected/github
* Updated @effected/github owns the octokit runtime
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces snapshots
* Updated A lockfile is a YAML stream, not always one document
* Updated Azure is confined to three modules, not two
* Updated Peer-dependency discipline
* Updated Pin heavy-dependency confinement with a reachability suite that has a positive control
* Added The blob transport is internal and HttpClient-based
* Updated The github-split (program name)
* Updated The libsodium sealed box stays in @effected/github until a second consumer appears
* Added The sealed box's primitives are copied from noble into @effected/github, with no third-party crypto dependency
* Updated actions-storage
* Updated github-actions
* Updated The cli package owns its display-width function
* Updated glob
* Updated glob does not bound total matching work on hostile patterns
* Updated lockfiles

## 2026-11-13

* Updated A lockfile is a YAML stream, not always one document
* Updated bun
* Updated lockfiles
* Updated npm
* Updated pnpm
* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces peer-dependency checking
* Updated @effected/changesets
* Updated NpmRegistry applies none of the npmrc proxy or TLS settings
* Updated @effected/workspaces discovery and detection
* Updated A yarn Berry lockfile has no devDependencies section
* Updated Add a kit package
* Updated PeerCheck cannot answer yarn
* Updated Yarn carries no resolved peer edges
* Updated effected
* Updated npm and bun rows never populate unresolvedEdges
* Updated @effected/workspaces: monorepo tooling

## 2026-11-12

* Updated glob
* Updated @effected/memfs
* Updated @effected/bundler
* Updated @effected/plugin
* Updated Peer-dependency discipline
* Updated effected.toml: the build config's tables, defaults and discovery
* Updated The effected build commands: package build, action build and action init
* Updated Package-manager support window
* Updated workspace
* Updated actions-storage
* Added bun
* Updated effected
* Added pnpm
* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces peer-dependency checking
* Updated @effected/workspaces: monorepo tooling
* Updated Library tier (pure / boundary / integrated)
* Added The catalog: and workspace: protocols are shared, so their contracts stay in @effected/npm
* Updated npm

## 2026-11-11

* Updated Peer-dependency discipline
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces snapshots
* Updated @effected/workspaces: monorepo tooling
* Updated npm

## 2026-11-10

* Updated @effected/changesets
* Updated git
* Updated @effected/semver stays independent of core SemVer and SemVerRange
* Updated semver
* Updated Consumers see one catalog, effected, folded by the plugin's hook from split declarations
* Updated The catalog:sync / catalog:check CLI
* Updated The plugin declares one catalog, effected, and pins only the Effect family by include pattern
* Updated The typechecker: tsc, not tsgo
* Updated The plugin declares a second consumer-visible catalog, effected:build, for the kit's build chain
* Updated pnpm-plugin-effected
* Updated @effected/bundler
* Updated @effected/engine
* Updated @effected/plugin
* Updated Only @effected/bundler imports typescript, and only it and the tool's packages peer it
* Updated effected
* Added @effect/platform-node declares redis as a required peer, so every kit package on it brings redis along
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/mcp-kit
* Updated The effect catalog holds the Effect family to one minor with tilde ranges
* Updated The effect family is pinned graph-wide by overrides derived from the catalog
* Updated The effected catalog literal
* Updated workspace
* Updated The build artifacts: dist/prod, targets.json, issues.json and the journals
* Updated The effected build commands: package build, action build and action init
* Updated effected.toml: the build config's tables, defaults and discovery
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces: monorepo tooling
* Updated WorkspacesSync is a `*Sync` escape hatch, not a `*Result` pure form
* Updated @effected/shell
* Updated @effected/memfs
* Updated walker
* Updated lockfiles
* Updated npm

## 2026-11-09

* Updated @effected/plugin
* Updated After a workspace package is renamed, the next pnpm run installs before it runs the script
* Updated Consumers see one catalog, effected, folded by the plugin's hook from split declarations
* Updated Every package carries the same manifest shape and file set
* Updated Only @effected/bundler imports typescript, and only it and the tool's packages peer it
* Updated Peer-dependency discipline
* Updated The catalog:sync / catalog:check CLI
* Added The plugin declares a second consumer-visible catalog, effected:build, for the kit's build chain
* Updated The plugin declares one catalog, effected, and pins only the Effect family by include pattern
* Updated The typechecker: tsc, not tsgo
* Updated catalog:build is missing from pnpm-workspace.yaml because it is injected
* Updated pnpm-plugin-effected
* Updated scratchpad
* Updated workspace
* Updated @effected/bundler
* Updated ai-plugin
* Updated @effected/github
* Updated @effected/changesets
* Updated @effected/markdown-lint

## 2026-11-08

* Updated glob
* Updated glob does not bound total matching work on hostile patterns
* Updated lockfiles
* Updated walker
* Updated npm
* Updated @effected/crypto
* Updated @effected/files
* Updated @effected/schemastore
* Updated @effected/templates
* Updated config-file
* Updated package-json
* Updated @effected/markdown-lint
* Updated @effected/shell
* Updated @effected/bundler
* Updated effected.toml: the build config's tables, defaults and discovery
* Updated @effected/oidc
* Updated @effected/s3
* Updated @effected/changesets
* Updated @effected/cli
* Updated @effected/engine
* Updated @effected/mcp
* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated The effected build commands: package build, action build and action init
* Updated effected
* Updated @effected/markdown frontmatter
* Updated Build logs are two append-only journals at the workspace root, derived from a cached per-package issues.json
* Updated Consumers see one catalog, effected, folded by the plugin's hook from split declarations
* Updated New ae-forgotten-export errors after a bundler bump are TypeScript 7.1 emitting typeof a module local, not a bundler regression
* Updated PackedInstall packs the prod npm directory by default
* Updated Raw S3 objects get their own boundary package, with a ListObjectsV2 reader that fails a wrong root
* Updated Releases are changeset-driven and scope-agnostic
* Updated Shell syntax analysis is its own pure package, @effected/shell, not a commands subpath or core CommandLine
* Updated The catalog:sync / catalog:check CLI
* Updated The effect catalog holds the Effect family to one minor with tilde ranges
* Updated The effect family is pinned graph-wide by overrides derived from the catalog
* Updated The effected catalog holds next-release versions, and the publish order follows
* Updated The kit builds itself with the bundler running from source under tsx
* Updated The kit has one build target, and workspace links point at package roots
* Updated The markdownlint-compatible lint shape is its own pure package; @effected/markdown gains only the callback visitor
* Updated The monorepo holds one tool, effected, beside its libraries
* Updated The numeric-enum codec is data, not a typescript dependency
* Updated The plugin declares one catalog, effected, and pins only the Effect family by include pattern
* Updated The ui declarations reference the root's types by the package's own name
* Updated There is no Effect v3 catalog and no camelCase catalog alias
* Updated effected.toml is the only build config, and code enters through two data keys
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/plugin
* Added @effected/manifest
* Updated The build artifacts: dist/prod, targets.json, issues.json and the journals
* Added The bundle manifest is its own pure package, @effected/manifest, emitted as a platform-neutral bundle.json
* Updated spencerbeggs/tsdoctor
* Added NpmRegistry applies none of the npmrc proxy or TLS settings
* Updated Add a kit package
* Updated Add a workspace package

## 2026-11-07

* Updated The kit builds itself with the bundler running from source under tsx
* Updated effected.toml: the build config's tables, defaults and discovery
* Updated glob
* Added glob does not bound total matching work on hostile patterns
* Updated walker
* Updated @effected/markdown
* Updated @effected/crypto
* Updated @effected/webhooks
* Updated @effected/files
* Updated lockfiles
* Updated npm
* Updated @effected/workspaces: monorepo tooling
* Updated @effected/github
* Added bun below 1.4.4 hoists api-extractor's typescript over the tool's peer
* Updated @effected/markdown frontmatter
* Added @effected/s3
* Added Raw S3 objects get their own boundary package, with a ListObjectsV2 reader that fails a wrong root
* Added @effected/markdown-lint
* Added The markdownlint-compatible lint shape is its own pure package; @effected/markdown gains only the callback visitor
* Updated effected
* Added @effected/shell
* Added Shell syntax analysis is its own pure package, @effected/shell, not a commands subpath or core CommandLine

## 2026-11-06

* Updated "Wait for the kit" leaves raw spawns and duplicated regex behind
* Updated @effected/mcp-kit
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces peer-dependency checking
* Updated An upgrade-ledger entry is one change, selected by the versions a consumer's upgrade crosses
* Updated D: strict MCP input default for Claude Code
* Updated Design a GitHub Action repository on the kit
* Updated FORCE_COLOR is honoured, with Node's getColorDepth precedence
* Updated One tracking package versions both plugin builds
* Updated Regenerate the GitHub Action template repository
* Updated Require the consolidated core's contract in R; never re-implement or re-declare it
* Updated Schemastore retiers from boundary to integrated for a direct ajv dependency
* Updated Strict MCP input is reported by core; McpToolkit appends the accepted params instead of pre-checking
* Updated The ajv engine lives in the effected tool, and the library returns to boundary tier
* Updated The effect catalog takes caret ranges on the stable line
* Updated The libsodium sealed box stays in @effected/github until a second consumer appears
* Updated The schemastore commands live in the effected tool, and the companion package is removed
* Added @effected/bundler
* Added @effected/changesets
* Updated effected
* Added Build logs are two append-only journals at the workspace root, derived from a cached per-package issues.json
* Added No @effected/* package imports or peers typescript, except @effected/bundler
* Updated No @effected/* package imports typescript
* Added The kit builds itself with the bundler running from source under tsx
* Added The kit has one build target, and workspace links point at package roots
* Added effected.toml is the only build config, and code enters through two data keys
* Updated tsconfig-json
* Updated Close a catalog membership gap
* Updated The catalog:sync / catalog:check CLI
* Updated Ghost workspace
* Updated scratchpad
* Updated pnpm-plugin-effected
* Updated A turbo cache hit reads exactly like a fresh build in the log
* Updated Build through turbo
* Updated Running the bundler script directly fakes a clean build gate
* Updated State which count moved and why, whenever a gate's number changes
* Updated workspace
* Updated @effected/commands
* Updated @effected/images
* Updated @effected/jsonl
* Updated @effected/jwt
* Updated @effected/memfs
* Updated @effected/schema-org
* Updated @effected/schemastore
* Updated @effected/templates
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/workspaces: monorepo tooling
* Updated @effected/yaml
* Updated A package that names its own root types once showed one warning or none, until the bundler resolved the self-reference to declarations
* Updated Add a workspace package
* Updated Advance the effect pin
* Updated Agents never run pnpm:up, pnpm:preview, or pnpm:export
* Updated Consumers see one catalog, effected, folded by the plugin's hook from split declarations
* Updated Dependency policy: R1-R4
* Updated Every package carries the same manifest shape and file set
* Updated Library tier (pure / boundary / integrated)
* Updated New ae-forgotten-export errors after a bundler bump are TypeScript 7.1 emitting typeof a module local, not a bundler regression
* Updated PackedInstall packs the prod npm directory by default
* Updated Peer-dependency discipline
* Updated Read publishability from publishConfig.access, never from private
* Updated Testing standards
* Updated The effect catalog holds the Effect family to one minor with tilde ranges
* Updated The effect family is pinned graph-wide by overrides derived from the catalog
* Updated The effected catalog holds next-release versions, and the publish order follows
* Updated The effected catalog literal
* Updated The plugin declares one catalog, effected, and pins only the Effect family by include pattern
* Updated The ui declarations reference the root's types by the package's own name
* Updated There is no Effect v3 catalog and no camelCase catalog alias
* Updated ae-forgotten-export on _base looks like a real export bug; it is a synthesized, un-nameable symbol
* Updated ai-plugin
* Updated app
* Updated config-file
* Updated glob
* Updated jsonc
* Updated lockfiles
* Updated npm
* Updated package-json
* Updated pnpm:export keeps a catalog the plugin no longer declares
* Updated runtimes
* Updated semver
* Updated store
* Updated toml
* Updated walker
* Updated website
* Updated xdg
* Updated The catalog sync moved the effect catalog onto Effect 4.1 under a kit built on 4.0
* Updated The effect catalog locks every entry to an exact version, held by overrides
* Updated The plugin's catalog paired 4.0.3 satellites with core effect 4.0.2
* Added The build artifacts: dist/prod, targets.json, issues.json and the journals
* Added The effected build commands: package build and action build
* Added effected.toml: the build config's tables, defaults and discovery
* Updated @effected/cli
* Updated @effected/engine
* Updated @effected/mcp
* Updated @effected/plugin
* Updated Keep the tree resolved to one effect copy
* Updated Releases are changeset-driven and scope-agnostic
* Updated The monorepo holds one tool, effected, beside its libraries
* Updated The numeric-enum codec is data, not a typescript dependency
* Updated spencerbeggs/tsdoctor
* Updated Only @effected/bundler imports typescript, and only it and the tool's packages peer it

## 2026-11-05

* Updated @effected/source
* Updated @effected/kit
* Updated @effected/cli
* Updated @effected/cli-kit
* Updated @effected/engine
* Updated @effected/mcp
* Updated @effected/mcp-kit
* Updated @effected/plugin
* Updated @effected/schemastore
* Added A config from another schemastore version fails the CLI and only warns the MCP
* Updated A declared-family key must be a name ajv can register, and its payload cannot carry an $id
* Added A long-lived MCP server does not see an edit to an imported native module until it restarts
* Updated A schemastore outputDir is never exclusively the command's
* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated Calling ajv-formats' default import is a TS2349, and the one-hop `.default` is not a bug
* Updated CliLinks finds the project root with @effected/walker
* Updated Companion package
* Updated D3: CliLogger's stderrFrom default flips to All
* Updated Dependency policy: R1-R4
* Updated Error handling standards
* Updated Library tier (pure / boundary / integrated)
* Updated No bin on the library — the executable lives in the effected tool
* Updated No layerDefault on SchemaValidator or SchemaFile
* Updated No shipped templates/ directory
* Updated PackedInstall packs the prod npm directory by default
* Updated Peer-dependency discipline
* Updated Schemastore retiers from boundary to integrated for a direct ajv dependency
* Updated The ajv engine lives in the effected tool, and the library returns to boundary tier
* Updated The cli root stays boundary, and ./ui is integrated only for consumers who opt in
* Added The effected schema command writes tab-indented, fully expanded JSON only
* Added The effected schema commands: build, check and validate
* Updated The monorepo holds one tool, effected, beside its libraries
* Added The schemastore commands live in the effected tool, and the companion package is removed
* Updated The validation gate ships a real ajv engine, closed by default
* Updated ai-plugin
* Updated effected
* Updated spencerbeggs/okfit
* Added @effected/files
* Updated store
* Updated @effected/templates
* Updated config-file
* Updated package-json
* Updated @effected/workspaces: monorepo tooling
* Updated The Catalog Sync check goes RED when it found and fixed drift
* Updated xdg stays independent of core UserDirectories
* Updated D9: CliTest uses core ChildProcess, with no peer on @effected/commands
* Added Atomic writes live in their own package, @effected/files, not in @effected/kit or @effected/store
* Updated jsonc
* Updated The package-json decode-free text path
* Updated glob
* Updated glob is a full-fidelity vendored port, not a minimal runtime dependency
* Updated semver
* Updated @effected/env
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/memfs
* Updated github-actions
* Updated @effected/markdown
* Updated @effected/github
* Updated @effected/yaml

## 2026-11-02

* Updated A plugin skill is a lean index over references
* Updated Advance the effect pin
* Added An upgrade-ledger entry is one change, selected by the versions a consumer's upgrade crosses
* Updated Author the plugin once in plugin/, never edit its builds
* Added Consumer upgrades run one fixed plugin process over an append-only ledger of per-change entries
* Updated Consumer-facing text states current Effect behaviour, never versions
* Updated Never hand-edit the construct index — regenerate it
* Updated One tracking package versions both plugin builds
* Updated Release a plugin
* Updated ai-plugin
* Updated construct-annotations.json
* Updated workspace
* Added @effected/cli-kit
* Updated @effected/cli-kit depends on @effected/kit as a regular dependency, for distribution
* Updated @effected/cli-kit grows a presentation layer and interactive UI
* Updated @effected/cli-kit is not a CLI framework
* Updated @effected/commands
* Updated @effected/env
* Updated @effected/env is its own boundary package, a required peer of cli
* Updated @effected/github-commands
* Added @effected/kit
* Updated @effected/lsp
* Added @effected/mcp-kit
* Updated @effected/mcp-kit ships StdioCapture behind a Node-only ./node subpath, licensed for two node: imports
* Updated @effected/schemastore-cli
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated A live view is a scoped drain of runs, hosted or owned, with no input and the mount permit per run
* Updated A public lookup that can miss returns Option, never T | undefined
* Updated A second published entrypoint is a measured cost, not a convenience
* Updated A zero-width space never stopped the Actions runner reading a workflow command
* Updated CliLinks finds the editor directory with its own bounded ascent
* Updated CliLinks finds the project root with @effected/walker
* Updated CliLogger honours LogToStderr only as a force-all override
* Updated D10: McpToolAudit enforces object-rooted outputs by default
* Updated D1: @effected/kit exists and holds Distribution, Remediation and LaunchContext
* Updated D2: strict MCP input is upstream-first
* Updated D3: CliLogger's stderrFrom default flips to All
* Updated D4: okfit and vitest-agent are registered as consumers before extraction
* Updated D5: the layering, packed-install and boundary checks live in @effected/workspaces/testing
* Updated D7: usageExitCode defaults to 64 (BSD EX_USAGE)
* Updated D8: CliColor ignores FORCE_COLOR, matching core
* Updated D9: CliTest uses core ChildProcess, with no peer on @effected/commands
* Updated Error handling standards
* Updated Ink delivers every key in one stdin read before React re-renders
* Updated No bin on the library — the CLI is a fixed-version companion package
* Updated Only ./ui may bind Node's process streams, and only in three named files
* Updated PackedInstall packs the prod npm directory by default
* Updated Plan a surface's first consumer port as a design round
* Updated React 19's development reconciler leaked user-timing entries on every render, until react-reconciler 0.34
* Updated Strict MCP input is reported by core; McpToolkit appends the accepted params instead of pre-checking
* Updated The Ink layer is a ./ui subpath of cli, with ink and react as optional peers
* Updated The audience flag is four shared root flags resolved into env's Audience
* Updated The cli package owns its display-width function
* Updated The cli root boundary is a module-graph walk, not a per-file scan
* Updated The cli root stays boundary, and ./ui is integrated only for consumers who opt in
* Updated The document IR is plain frozen data, not Schema classes
* Updated The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location
* Updated The kit's layering check forbids runtime edges only
* Updated The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook
* Updated The live view never calls Ink's clear(); a new run re-renders in place or remounts
* Updated The live view's tick is a scoped Effect schedule, and its frame index comes from Clock
* Updated The ui declarations reference the root's types by the package's own name
* Updated The workflow-command grammar left github-actions for its own pure package
* Updated While a live view is mounted, kit logs go through Ink's own stdout and stderr writers
* Updated cli files the Command handler-accessor gap upstream rather than shimming it
* Updated cli sets the exit code through core's own Runtime markers
* Updated effected
* Updated github-actions
* Updated savvy-web/systems
* Updated spencerbeggs/okfit
* Updated spencerbeggs/reposets
* Updated spencerbeggs/vitest-agent
* Updated @effected/images
* Updated A package that names its own root types once showed one warning or none, until the bundler resolved the self-reference to declarations
* Updated D6: CLI and MCP knowledge stays in separate skills, linked from design-patterns
* Updated Releases are changeset-driven and scope-agnostic
* Added @effected/cli
* Added @effected/engine
* Added @effected/mcp
* Added @effected/plugin
* Added The carrier libraries take -kit names, with no shim
* Added The monorepo holds one tool, effected, beside its libraries
* Updated pnpm-plugin-effected

## 2026-11-01

* Updated Advance the effect pin
* Updated An unsatisfiable effect peer installs clean and fails somewhere else
* Updated Consumer-facing text states current Effect behaviour, never versions
* Updated Consumers see one catalog, effected, folded by the plugin's hook from split declarations
* Updated Every package carries the same manifest shape and file set
* Updated Keep the tree resolved to one effect copy
* Updated The catalog sync moved the effect catalog onto Effect 4.1 under a kit built on 4.0
* Updated The catalog:sync / catalog:check CLI
* Updated The effected catalog literal
* Added The plugin declares one catalog, effected, and pins only the Effect family by include pattern
* Updated effected
* Updated pnpm peers check is expected to report exactly one occupant
* Updated pnpm-plugin-effected
* Added pnpm:export keeps a catalog the plugin no longer declares
* Updated scratchpad
* Updated workspace

## 2026-10-31

* Updated @effected/cli
* Updated @effected/commands
* Updated @effected/crypto
* Updated @effected/images
* Updated @effected/jwt
* Updated @effected/mcp
* Updated @effected/memfs
* Updated @effected/schemastore-cli
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated Add a workspace package
* Updated Advance the effect pin
* Added After a workspace package is renamed, the next pnpm run installs before it runs the script
* Updated Agents never run pnpm:up, pnpm:preview, or pnpm:export
* Updated An unsatisfiable effect peer installs clean and fails somewhere else
* Updated App auth, OIDC verify and the token store land in @effected/github
* Updated Close a catalog membership gap
* Updated Companion package
* Updated ConstantTime.equal is best-effort constant time
* Added Consumers see one catalog, effected, folded by the plugin's hook from split declarations
* Updated Every package carries the same manifest shape and file set
* Updated Keep the tree resolved to one effect copy
* Updated Keyed operations come from WebCrypto, payload digests from core Digest required in R
* Updated Library tier (pure / boundary / integrated)
* Updated Publish a snapshot
* Updated Read publishability from publishConfig.access, never from private
* Updated Releases are changeset-driven and scope-agnostic
* Updated Require the consolidated core's contract in R; never re-implement or re-declare it
* Updated Sync-primitive policy
* Added The catalog sync moved the effect catalog onto Effect 4.1 under a kit built on 4.0
* Updated The catalog:sync / catalog:check CLI
* Updated The config companion is named @effected/plugin, not built yet
* Added The effect catalog holds the Effect family to one minor with tilde ranges
* Updated The effect catalog locks every entry to an exact version, held by overrides
* Updated The effect catalog pins exact versions
* Updated The effect catalog takes caret ranges on the stable line
* Updated The effect family is pinned graph-wide by overrides derived from the catalog
* Updated The effected catalog holds next-release versions, and the publish order follows
* Updated The effected catalog literal
* Updated The libsodium sealed box stays in @effected/github until a second consumer appears
* Updated The plugin's catalog paired 4.0.3 satellites with core effect 4.0.2
* Updated The sync form is named `*Result`, never `*Sync`
* Updated There is no Effect v3 catalog and no camelCase catalog alias
* Updated Vendored Effect is pinned to the lockfile's tag, not main
* Updated config-file
* Updated effected
* Updated github-actions
* Updated jsonc
* Updated memfs takes zero @effected/* edges, ever
* Updated npm
* Updated pnpm add --config silently strips integrity hashes from every config dependency
* Updated pnpm peers check is expected to report exactly one occupant
* Added pnpm-plugin-effected
* Updated pnpm-plugin-effected is deliberately absent from its own effected catalog
* Updated workspace
* Updated @effected/github
* Updated @effected/github App authentication
* Updated @effected/oidc
* Updated @effected/webhooks
* Updated Keyed operations come from core Mac, payload digests from core Digest, both required in R

## 2026-10-29

* Updated @effected/cli depends on @effected/engine as a regular dependency, for distribution
* Updated @effected/github GraphQL
* Updated @effected/github REST client
* Updated @effected/github errors and retry
* Updated @effected/mcp ships StdioCapture behind a Node-only ./node subpath, licensed for two node: imports
* Updated @effected/workspaces discovery and detection
* Updated @effected/yaml lint system
* Updated @effected/yaml stringify options
* Updated A physical ascend ceiling is a separate static taking an Option, not a realpath mode of stopAt
* Updated A second published entrypoint is a measured cost, not a convenience
* Updated D1: @effected/engine exists and holds Distribution, Remediation and LaunchContext
* Updated Git failure classification happens once, in one private function
* Updated Only ./ui may bind Node's process streams, and only in three named files
* Updated RunOnce trusts a done marker only from an owner it observed, and breaks a lock through per-contender tickets and a rename-based compare-and-delete
* Updated Store.migrateOnce keeps a process-global registry of plain Promises
* Updated The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location
* Updated The package-json decode-free text path
* Updated The package-json entry-point resolver
* Updated actions-attestation
* Updated actions-runtime
* Updated actions-storage
* Updated app's test layer lives behind ./testing, with memfs an optional peer
* Updated @effected/env
* Updated git
* Updated walker

## 2026-10-28

* Updated @effected/cli
* Updated @effected/crypto
* Updated @effected/env
* Updated @effected/mcp
* Updated Keyed operations come from WebCrypto, payload digests from core Crypto required in R
* Updated xdg
* Added @effected/source
* Updated effected
* Updated jsonc
* Updated toml
* Updated Add a kit package
* Updated walker
* Updated @effected/engine
* Updated git
* Updated config-file
* Updated @effected/memfs
* Updated @effected/github
* Updated @effected/github REST client
* Updated npm
* Updated package-json
* Updated The package-json entry-point resolver
* Added The package-json exports resolver
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/workspaces: monorepo tooling
* Updated @effected/workspaces discovery and detection
* Updated @effected/commands
* Updated Run.collect drains stdout, stderr and the exit code concurrently
* Updated RunOnce trusts a done marker only from an owner it observed, and breaks a lock through per-contender tickets and a rename-based compare-and-delete
* Updated @effected/markdown
* Updated @effected/yaml
* Updated @effected/yaml lint system
* Updated @effected/lsp
* Updated Error handling standards
* Updated @effected/github GraphQL
* Updated @effected/jwt
* Updated actions-storage
* Updated runtimes
* Updated @effected/github errors and retry
* Updated github-actions

## 2026-10-27

* Updated Error handling standards
* Updated @effected/cli
* Added @effected/cli depends on @effected/engine as a regular dependency, for distribution
* Updated @effected/commands
* Updated @effected/commands does not supervise or archive processes
* Updated @effected/engine
* Updated @effected/env
* Updated @effected/mcp
* Added @effected/mcp ships StdioCapture behind a Node-only ./node subpath, licensed for two node: imports
* Updated @effected/memfs
* Updated A physical ascend ceiling is a separate static taking an Option, not a realpath mode of stopAt
* Updated A second published entrypoint is a measured cost, not a convenience
* Added AppDirs.segment does not refuse Windows trailing dots or device names
* Updated D1: @effected/engine exists and holds Distribution, Remediation and LaunchContext
* Updated Every git constructor and error path carries the redaction mask
* Updated Git failure classification happens once, in one private function
* Updated Only ./ui may bind Node's process streams, and only in three named files
* Added RunOnce trusts a done marker only from an owner it observed, and breaks a lock through per-contender tickets and a rename-based compare-and-delete
* Added Store.migrateOnce keeps a process-global registry of plain Promises
* Updated The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location
* Updated app
* Added app's test layer lives behind ./testing, with memfs an optional peer
* Updated config-file
* Updated git
* Updated glob
* Updated store
* Updated walker
* Updated xdg

## 2026-10-25

* Updated @effected/crypto
* Updated @effected/github
* Updated @effected/markdown
* Updated @effected/memfs
* Updated Only entrypoint files re-export; never a barrel or a namespace object
* Updated Schema standards
* Updated config-file
* Updated config-file's codecs are free-standing named exports, never a namespace object
* Updated github-actions
* Updated semver
* Updated semver's parse and intersect Results are the primitive
* Updated store
* Updated toml
* Updated walker
* Updated workspace
* Updated @effected/commands
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces: monorepo tooling
* Updated A second published entrypoint is a measured cost, not a convenience
* Added A tool installed only globally also probes as local, because the package manager's exec falls through to PATH
* Added New ae-forgotten-export errors after a bundler bump are TypeScript 7.1 emitting typeof a module local, not a bundler regression
* Updated WorkspacesSync is a `*Sync` escape hatch, not a `*Result` pure form
* Updated ae-forgotten-export on _base looks like a real export bug; it is a synthesized, un-nameable symbol
* Updated savvy-web/systems
* Updated @effected/semver stays independent of core SemVer and SemVerRange
* Updated Contract inversion is the default answer to a tier-dragging edge
* Updated Each runtimes resolver exposes three lazy layer constants, not one configurable layer
* Updated Format-package naming is `*Format`, not `*Unvalidated`
* Updated Keyed operations come from WebCrypto, payload digests from core Crypto required in R
* Updated The Draft-07 meta-schema constant keeps its trailing hash
* Updated The libsodium sealed box stays in @effected/github until a second consumer appears
* Updated The sync form is named `*Result`, never `*Sync`
* Updated xdg stays independent of core UserDirectories

## 2026-10-24

* Updated @effected/cli
* Updated @effected/github-commands
* Updated actions-attestation
* Updated github-actions
* Updated @effected/markdown
* Updated A public lookup that can miss returns Option, never T | undefined
* Updated @effected/crypto
* Updated @effected/github
* Updated @effected/semver stays independent of core SemVer and SemVerRange
* Updated @effected/workspaces: monorepo tooling
* Updated @effected/yaml
* Updated Error handling standards
* Updated Testing standards
* Added The libsodium sealed box stays in @effected/github until a second consumer appears
* Updated app
* Updated config-file
* Updated git
* Updated sbom
* Updated semver
* Updated store
* Updated workspace

## 2026-10-23

* Updated @effected/crypto
* Updated @effected/oidc
* Updated @effected/webhooks
* Updated Contract inversion is the default answer to a tier-dragging edge
* Updated effected
* Updated npm
* Updated @effected/cli
* Updated @effected/commands
* Updated @effected/images
* Updated @effected/jsonl
* Updated @effected/jwt
* Updated @effected/markdown
* Updated @effected/mcp
* Updated @effected/schemastore
* Updated @effected/schemastore-cli
* Updated @effected/semver stays independent of core SemVer and SemVerRange
* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/workspaces: monorepo tooling
* Updated @effected/yaml
* Updated @effected/yaml stringify options
* Updated A package that names its own root types once showed one warning or none, until the bundler resolved the self-reference to declarations
* Updated A plugin skill is a lean index over references
* Updated A public lookup that can miss returns Option, never T | undefined
* Updated A renamed field typed never turns a silent conditional-spread drop into a compile error
* Updated Advance the effect pin
* Added ConstantTime.equal is best-effort constant time
* Updated Each runtimes resolver exposes three lazy layer constants, not one configurable layer
* Updated Error handling standards
* Updated Format-package convention
* Updated Format-package naming is `*Format`, not `*Unvalidated`
* Updated Input-hardening standards
* Updated Keyed operations come from WebCrypto, payload digests from core Crypto required in R
* Updated Observability standards
* Updated Only entrypoint files re-export; never a barrel or a namespace object
* Updated Sync-primitive policy
* Updated The Draft-07 meta-schema constant keeps its trailing hash
* Updated The package-json decode-free text path
* Updated The sync form is named `*Result`, never `*Sync`
* Updated actions-runtime
* Updated actions-storage
* Updated ai-plugin
* Updated config-file
* Updated git
* Updated github-actions
* Updated jsonc
* Added npm names its publish auth path only below its default log level
* Updated package-json
* Updated runtimes
* Updated semver
* Updated toml
* Updated xdg
* Added xdg stays independent of core UserDirectories

## 2026-10-22

* Updated @effected/memfs
* Added @effected/crypto
* Updated @effected/github
* Added @effected/oidc
* Added @effected/oidc is a thin package that owns the IdentityToken contract
* Added @effected/webhooks
* Added ConstantTime.equal is best-effort constant time
* Added HMAC comes from WebCrypto, digests from core Crypto required in R
* Added One GitHub Actions OIDC claims class, ActionsOidcClaims in @effected/github
* Updated actions-attestation
* Updated github-actions
* Updated npm
* Updated sbom

## 2026-10-21

* Updated @effected/markdown
* Updated The live view never calls Ink's clear(); a new run re-renders in place or remounts

## 2026-10-19

* Updated @effected/memfs
* Updated A flaky jsonl watcher is probably an arming-order window, not an unreliable platform watch
* Updated The effect family is pinned graph-wide by overrides derived from the catalog

## 2026-10-14

* Updated The effected catalog literal
* Updated pnpm-plugin-effect

## 2026-10-11

* Updated @effected/cli
* Updated @effected/env
* Updated @effected/github App authentication
* Updated @effected/memfs
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/workspaces: monorepo tooling
* Updated Advance the effect pin
* Updated An unsatisfiable effect peer installs clean and fails somewhere else
* Updated Keep the tree resolved to one effect copy
* Added The effect family is pinned graph-wide by overrides derived from the catalog
* Updated The effected catalog literal
* Updated The plugin's catalog paired 4.0.3 satellites with core effect 4.0.2
* Updated pnpm-plugin-effect
* Updated workspace

## 2026-10-10

* Updated @effected/github
* Updated @effected/github errors and retry
* Updated @effected/github owns the octokit runtime
* Added @effected/jwt
* Added App auth, OIDC verify and the token store land in @effected/github
* Updated Only ./ui may bind Node's process streams, and only in three named files
* Added The JWT algorithm comes from the key, never the token header
* Updated effected
* Updated @effected/github App authentication
* Updated @effected/github resource services
* Updated Advance the effect pin
* Updated An unsatisfiable effect peer installs clean and fails somewhere else
* Updated Consumer-facing text states current Effect behaviour, never versions
* Updated Keep the tree resolved to one effect copy
* Updated Releases are changeset-driven and scope-agnostic
* Added The effect catalog locks every entry to an exact version, held by overrides
* Updated The effected catalog literal
* Added The plugin's catalog paired 4.0.3 satellites with core effect 4.0.2
* Updated Vendored Effect is pinned to the lockfile's tag, not main
* Updated pnpm-plugin-effect
* Updated workspace

## 2026-10-09

* Added Image formats are read by in-house header readers
* Added The image cache backend is a structural port, not a store dependency
* Updated effected
* Updated @effected/images
* Added A package that names its own root types shows one warning or none, depending on whether the second pass crashes
* Updated Author the plugin once in plugin/, never edit its builds
* Updated ai-plugin
* Updated Each plugin versions via its own private tracking package
* Updated @effected/cli
* Updated @effected/schemastore-cli
* Added The schemastore CLI writes tab-indented, fully expanded JSON only

## 2026-10-08

* Updated @effected/cli
* Updated React 19's development reconciler leaked user-timing entries on every render, until react-reconciler 0.34
* Updated lockfiles
* Updated @effected/jsonl
* Updated @effected/jsonl journal service
* Updated A flaky jsonl watcher is probably an arming-order window, not an unreliable platform watch
* Added jsonl's watch is a service in R that succeeds only once registered, with a Node backend behind ./node

## 2026-10-07

* Updated @effected/jsonl
* Updated @effected/jsonl journal service
* Updated @effected/jsonl read surfaces
* Updated The jsonl Journal service is a per-registry factory, not a generic key
* Updated @effected/github-commands
* Updated @effected/spdx
* Updated A live view is a scoped drain of runs, hosted or owned, with no input and the mount permit per run
* Added A zero-width space never stopped the Actions runner reading a workflow command
* Updated Advance the effect pin
* Updated Author the plugin once in plugin/, never edit its builds
* Updated Ink delivers every key in one stdin read before React re-renders
* Updated Only ./ui may bind Node's process streams, and only in three named files
* Updated The Ink layer is a ./ui subpath of cli, with ink and react as optional peers
* Updated The committed SPDX license catalog
* Updated The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location
* Updated The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook
* Updated The live view never calls Ink's clear(); a new run re-renders in place or remounts
* Updated While a live view is mounted, kit logs go through Ink's own stdout and stderr writers
* Updated ai-plugin

## 2026-10-05

* Added @effected/lsp
* Updated effected
* Updated @effected/cli
* Updated @effected/engine
* Updated @effected/mcp
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/workspaces: monorepo tooling
* Updated Store is built on effect's own SQL core and @effect/sql-sqlite-node
* Updated app
* Updated store

## 2026-10-03

* Updated A capability recon pass at package level misses constructs the kit already ships
* Updated A plugin skill is a lean index over references
* Updated Add a kit package
* Updated Advance the effect pin
* Added Author the plugin once in plugin/, never edit its builds
* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated Carrier-only bins are recommended; shared bins are a supported choice
* Updated Change the Claude Code plugin first, then port to Copilot
* Updated Climb the evidence ladder in order — renames, then source, then a probe
* Updated Consumer-facing text states current Effect behaviour, never versions
* Updated Never hand-edit the construct index — regenerate it
* Added One tracking package versions both plugin builds
* Updated Release a plugin
* Updated The effect catalog takes caret ranges on the stable line
* Added ai-plugin
* Updated construct-annotations.json
* Updated effected
* Updated workspace
* Updated @effected/cli
* Updated @effected/schemastore-cli
* Updated app
* Updated store

## 2026-10-02

* Updated @effected/schemastore
* Updated @effected/schemastore-cli
* Updated The ajv engine lives in the CLI, and the library returns to boundary tier

## 2026-10-01

* Updated @effected/env
* Updated The audience flag is four shared root flags resolved into env's Audience
* Updated Peer-dependency discipline
* Updated @effected/cli
* Added @effected/github-commands
* Added The workflow-command grammar left github-actions for its own pure package
* Updated actions-runtime
* Updated effected
* Updated github-actions
* Added Only ./ui may bind Node's process streams, and only in three named files
* Added The Ink layer is a ./ui subpath of cli, with ink and react as optional peers
* Updated The cli root boundary is a module-graph walk, not a per-file scan
* Updated The cli root stays boundary, and ./ui is integrated only for consumers who opt in
* Added The kit sets Ink's colour level on Ink's own chalk, resolved from Ink's location
* Updated Ink delivers every key in one stdin read before React re-renders
* Added The ui declarations reference the root's types by the package's own name
* Added @effected/env is its own boundary package, a required peer of cli
* Updated @effected/mcp
* Updated @effected/memfs
* Updated @effected/workspaces: monorepo tooling
* Added A live view is a scoped drain of runs, hosted or owned, with no input and the mount permit per run
* Updated An unsatisfiable effect peer installs clean and fails somewhere else
* Updated D10: McpToolAudit enforces object-rooted outputs by default
* Added FORCE_COLOR is honoured, with Node's getColorDepth precedence
* Updated Keep the tree resolved to one effect copy
* Added React 19's development build leaks user-timing entries on every render
* Updated Releases are changeset-driven and scope-agnostic
* Updated The effected catalog literal
* Added The live frame is clamped to rows - 1 in height, and its root width is never taken from a hook
* Added The live view never calls Ink's clear(); a new run re-renders in place or remounts
* Updated The live view's tick is a scoped Effect schedule, and its frame index comes from Clock
* Updated Vendored Effect is pinned to the lockfile's tag, not main
* Updated Vendored repos manifest
* Added While a live view is mounted, kit logs go through Ink's own stdout and stderr writers
* Updated claude-code-plugin
* Updated pnpm-plugin-effect
* Updated spencerbeggs/okfit
* Updated spencerbeggs/vitest-agent
* Added std-osc8's pure core is ported into env, not wrapped

## 2026-09-30

* Updated @effected/jsonl
* Updated @effected/jsonl journal service
* Updated @effected/memfs
* Updated @effected/schemastore
* Updated @effected/templates
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated A test needing FileSystem uses memfs, never a hand-rolled layerNoop stub
* Updated Module layout is module-per-concept, not kind-based folders
* Updated Testing standards
* Updated github-actions
* Updated memfs's volume is invisible to anything that does not ask for the FileSystem service
* Updated @effected/env
* Updated @effected/env is its own boundary package, a required peer of cli
* Updated FORCE_COLOR is honoured, with Node's getColorDepth precedence
* Updated std-osc8's pure core is ported into env, not wrapped
* Updated @effected/cli grows a presentation layer and interactive UI
* Updated The audience flag is four shared root flags resolved into env's Audience
* Updated The cli package owns its display-width function
* Updated Two prompt engines raise one Cancelled error
* Updated CliLinks finds the editor directory with its own bounded ascent
* Added CliLinks finds the project root with @effected/walker
* Added The cli renderers have no JSON output
* Added The document IR is plain frozen data, not Schema classes

## 2026-09-29

* Updated @effected/schemastore
* Updated @effected/schemastore-cli
* Updated A schemastore outputDir is never exclusively the CLI's
* Updated Never hand-edit the construct index — regenerate it
* Updated actions-runtime
* Updated construct-annotations.json
* Updated github-actions
* Added A physical ascend ceiling is a separate static taking an Option, not a realpath mode of stopAt
* Updated git
* Updated walker

## 2026-09-28

* Updated @effected/cli
* Updated @effected/cli is not a CLI framework
* Updated @effected/commands
* Updated @effected/jsonl
* Updated @effected/mcp
* Updated @effected/workspaces: monorepo tooling
* Updated D2: strict MCP input is upstream-first
* Updated D7: usageExitCode defaults to 64 (BSD EX_USAGE)
* Updated D8: CliColor ignores FORCE_COLOR, matching core
* Updated Require the consolidated core's contract in R; never re-implement or re-declare it
* Updated Schema standards
* Updated Store is built on effect's own SQL core and @effect/sql-sqlite-node
* Added Strict MCP input is reported by core; McpToolkit appends the accepted params instead of pre-checking
* Updated Vendored Effect is pinned to the catalog tag, not main
* Updated cli files the Command handler-accessor gap upstream rather than shimming it
* Updated effected
* Updated npm
* Updated runtimes
* Updated runtimes reads GitHub over core HttpClient, never Octokit
* Updated store

## 2026-09-27

* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces snapshots
* Updated A lockfile is a YAML stream, not always one document
* Updated Publish a snapshot
* Updated Under the no-op hooks layer, a hook-injected catalog's range bump between two refs is invisible to a snapshot diff
* Updated actions-storage
* Updated lockfiles
* Updated npm
* Updated package-json
* Updated @effected/markdown
* Updated The markdown canonical form is a published commitment — a row that moves is a breaking change
* Updated @effected/workspaces peer-dependency checking
* Updated @effected/workspaces: monorepo tooling
* Updated silk-update-action

## 2026-09-25

* Updated @effected/cli
* Updated @effected/memfs
* Updated @effected/workspaces/testing: the repo-shape checks
* Updated Carrier-only bins are recommended; shared bins are a supported choice
* Updated savvy-web/systems
* Updated spencerbeggs/okfit
* Updated @effected/mcp
* Updated @effected/workspaces: monorepo tooling

## 2026-09-24

* Updated @effected/workspaces/testing: the repo-shape checks
* Updated @effected/workspaces: monorepo tooling
* Added PackedInstall packs the prod npm directory by default
* Added The kit's layering check forbids runtime edges only
* Updated @effected/commands
* Updated @effected/mcp
* Updated A plugin skill is a lean index over references
* Updated A vitest positional filter is a substring match, and a run from inside a package never loads the root config
* Added Consumer-facing text states current Effect behaviour, never versions
* Updated State which count moved and why, whenever a gate's number changes
* Updated claude-code-plugin
* Updated scratchpad
* Updated workspace
* Updated @effected/github errors and retry

## 2026-09-23

* Updated @effected/cli
* Added @effected/engine
* Added @effected/mcp
* Updated @effected/workspaces: monorepo tooling
* Added D10: McpToolAudit enforces object-rooted outputs by default
* Added D1: @effected/engine exists and holds Distribution, Remediation and LaunchContext
* Added D2: strict MCP input is upstream-first
* Added D3: CliLogger's stderrFrom default flips to All
* Added D4: okfit and vitest-agent are registered as consumers before extraction
* Added D5: the layering, packed-install and boundary checks live in @effected/workspaces/testing
* Added D6: CLI and MCP knowledge stays in separate skills, linked from design-patterns
* Added D7: usageExitCode defaults to 64 (BSD EX_USAGE)
* Added D8: CliColor ignores FORCE_COLOR, matching core
* Added D9: CliTest uses core ChildProcess, with no peer on @effected/commands
* Updated claude-code-plugin
* Updated effected
* Updated savvy-web/systems
* Updated spencerbeggs/okfit
* Updated spencerbeggs/vitest-agent
* Added D: strict MCP input default for Claude Code

## 2026-09-22

* Updated walker
* Updated @effected/commands
* Updated @effected/github
* Updated @effected/markdown
* Updated @effected/schemastore
* Updated @effected/schemastore-cli
* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces peer-dependency checking
* Updated @effected/workspaces snapshots
* Updated @effected/workspaces: monorepo tooling
* Updated @effected/yaml lint system
* Added A Git config read with no scope is the merged view, not the checkout's own
* Added A GitCommand constructor carries no cwd and no environment
* Added A declared-family key must be a name ajv can register, and its payload cannot carry an $id
* Added A mechanically repaired fixture set goes green while describing a state GitHub cannot produce
* Added A network-touching Git member's worst-case latency is a multiple of GIT_TIMEOUT
* Added A red markdown tripwire test may mean you fixed something, not broke it
* Added A repo-local protocol.file.allow does not reach a submodule add's internal clone
* Added A yarn Berry lockfile has no devDependencies section
* Added ActionEnvironment is the only reader of ambient process state
* Added Calling ajv-formats' default import is a TS2349, and the one-hop `.default` is not a bug
* Added CorepackIntegrityHash is consumed by identity, and only a runtime identity assertion can see a re-fork
* Updated Git failure classification happens once, in one private function
* Added Git.configSet cannot write a value that begins with a dash
* Added PackageManager's version and integrity fields ARE the schemas their owning packages export
* Added PeerCheck never joins the peers of a link:-resolved parent and still reports verified
* Added Run.collect drains stdout, stderr and the exit code concurrently
* Added Secret.ts is the only place a Redacted becomes a string
* Updated Testing standards
* Added The git ssh BatchMode pin is appended to what git would have used, and declines rather than substitutes
* Added The markdown canonical form is a published commitment — a row that moves is a breaking change
* Added The npm and bun resolution walk is deepest-first
* Added The package-json entry-point resolver
* Updated actions-reporting
* Updated actions-runtime
* Updated actions-storage
* Updated git
* Added git log --follow is not the unfollowed walk plus more
* Updated github-actions
* Updated lockfiles
* Updated npm
* Added npm and bun rows never populate unresolvedEdges
* Updated package-json
* Updated Vendored Effect is pinned to the catalog tag, not main
* Updated workspace

## 2026-09-20

* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces peer-dependency checking
* Updated @effected/workspaces snapshots
* Updated @effected/workspaces: monorepo tooling
* Updated PeerCheck cannot answer yarn
* Updated Under the no-op hooks layer, a hook-injected catalog's range bump between two refs is invisible to a snapshot diff

## 2026-09-19

* Updated Support the current major and one back of every package manager
* Updated Vendored Effect is pinned to the catalog tag, not main
* Added npm 12's pack --json is an object keyed by name, not an array

## 2026-09-17

* Updated "Wait for the kit" leaves raw spawns and duplicated regex behind
* Updated @effected/workspaces catalogs and the config-dependency seam
* Updated @effected/workspaces discovery and detection
* Updated @effected/workspaces peer-dependency checking
* Updated Design a GitHub Action repository on the kit
* Updated Regenerate the GitHub Action template repository
* Updated app
* Updated store
* Updated github-actions
* Updated actions-storage
* Added pnpm 12's placeholder bin dies as a SyntaxError when shimmed under node

## 2026-09-16

* Updated @effected/schemastore-cli
* Added A schemastore outputDir is never exclusively the CLI's

## 2026-09-15

* Updated @effected/schemastore
* Updated Build a GitHub Action repository to the kit's canonical shape
* Updated Companion package
* Updated Dependency policy: R1-R4
* Added Generated objects are closed by default, departing from core's open default
* Updated No layerDefault on SchemaValidator or SchemaFile
* Updated Schemastore retiers from boundary to integrated for a direct ajv dependency
* Added The ajv engine lives in the CLI, and the library returns to boundary tier
* Updated The validation gate ships a real ajv engine, closed by default
* Updated effected

## 2026-09-14

* Updated @effected/schemastore
* Added @effected/schemastore-cli
* Updated No bin on the library — the CLI is a fixed-version companion package

## 2026-09-13

* Initialized the bundle with the software-project profile
