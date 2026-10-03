# Log

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
