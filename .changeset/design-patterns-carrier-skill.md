---
"@effected/claude-code-plugin": minor
---

## Features

### `effect-v4-mcp` skill

- New `effect-v4-mcp` skill for building, wiring, testing and reviewing an MCP server on Effect v4: `effect/unstable/ai`'s `McpServer`, `Tool` and `Toolkit`, plus the `@effected/mcp` boundary that keeps stdout the JSON-RPC wire and makes tool failures readable to an agent.
- References cover server wiring (stdio launch, crash handling, one layer memo map per server), tools (strict input, failure envelopes, `structuredContent`), resources, and testing with `McpHarness`, `McpProcess`, `McpProbe` and `McpToolAudit`.

### `design-patterns` skill

- New `design-patterns` skill: an index of proven architecture patterns for building on Effect v4 and the `@effected` kit, with each pattern kept in its own loadable references. The first pattern is the carrier package: shared core, engine and front-end packages (CLI, MCP, LSP) delivered to consumers through one carrier package.
- Covers the direct-dependency bin-linking problem the pattern solves, the rule for `dependencies` versus peers, and the `bin.ts` / `main.ts` / `index.ts` entry contract with mirror bin shims.
- Covers threading versions through the components with a `Distribution` `Context.Reference` and `engine_version`, plus plugin loaders that run the project's own `node_modules/.bin` first and fall back to a major-pinned `npx`.
- Covers verification: a manifest DAG test with positive controls, source boundary tests, and a packed-install e2e test, pointing at the kit exports that implement each.
- Adds an optional reference on placing the app layer and config schemas: core owns the shape, its version and its hosted schema identity; the engine owns platform and config discovery.
- Case studies from okfit, vitest-agent and Silk, cited by public GitHub URL.

### `effect-v4-cli` skill

- Rewritten as a lean index over focused references: the core `effect/unstable/cli` framework, exit codes, output and logging, bin-only packages, testing a CLI, recipes and gotchas.
- Teaches the `@effected/cli` surface — `CliRuntime.main`, `CliExit`, `CliColor` and `@effected/cli/testing` — and the `CliLogger` default of `stderrFrom: "All"` (every level to stderr). Notes that `Command.runWith` renders a `CliError.UserError` itself, so `CliRuntime.reportFailures` / `main` skip re-printing it and exit with the usage code.

### Agents

- `effect-developer` and `effect-reviewer` preload `effect-v4-mcp` and `design-patterns`, and `effect-developer` also preloads `effect-v4-testing`. Both route front-end work to the matching skill: `effect-v4-cli` for command-line programs, `effect-v4-mcp` for MCP servers, `design-patterns` for a tool that ships more than one bin.

### `effected-packages` index

- Adds rows and references for the new `@effected/engine` (platform-free `Distribution`, `Remediation` and `LaunchContext` primitives shared across a tool's front ends) and `@effected/mcp` packages, with per-construct entries for both.
- Updates the `@effected/cli` row for its new `CliExit`, `CliColor`, `CliRuntime.main` and `@effected/cli/testing` surface, and the `@effected/workspaces` row for its new `@effected/workspaces/testing` subpath (`WorkspaceLayering`, `SourceBoundary`, `PackedInstall`).
- Package count corrected to 34.

### `effect-v4-testing` skill

- Routes front-end and repo-shape testing to its owner: `CliTest` via `effect-v4-cli`, `McpHarness` / `McpProbe` via `effect-v4-mcp`, and repo-shape checks via `@effected/workspaces/testing`.
- Adds guidance on dead timeouts, unobserved forks and real-clock suites.

## Bug Fixes

- Skills and agents now state current Effect behaviour without prerelease version numbers or history, which went stale as the kit's Effect pin moved. The `@effect/vitest` install guidance now gives the rule (pin the exact prerelease your `effect` pins) instead of a dated dist-tag table.
- Corrected the vitest verification guidance in the agents and `effect-v4-testing`: read both the `Tests:` line and the exit code, since a run that collects nothing prints `Tests: 0/0 passed` and exits 1, and a project-filtered run from inside a package does not load the root config.
