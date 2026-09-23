# Log

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
