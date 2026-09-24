---
"@effected/copilot-plugin": minor
---

## Features

Brings the Copilot port level with the Claude Code plugin's front-end kit skills.

### New skills

- `effect-v4-mcp` — building, wiring, testing and reviewing an MCP server on Effect v4: `effect/unstable/ai`'s `McpServer`, `Tool` and `Toolkit`, plus the `@effected/mcp` boundary that keeps stdout the JSON-RPC wire. References cover server wiring, tools, resources and testing with `McpHarness`, `McpProcess`, `McpProbe` and `McpToolAudit`.
- `design-patterns` — an index of proven architecture patterns for building on Effect v4 and the `@effected` kit, starting with the carrier package pattern: shared core, engine and front-end packages (CLI, MCP, LSP) delivered through one carrier package, with references on the entry contract, version threading, plugin loaders, verification, and case studies.

### Updated skills and agents

- `effect-v4-cli` is now a lean index over focused references (core framework, exit codes, output and logging, bin-only packages, testing a CLI, recipes, gotchas) and teaches the `@effected/cli` surface: `CliRuntime.main`, `CliExit`, `CliColor`, `@effected/cli/testing`, and the `CliLogger` default of `stderrFrom: "All"`.
- `effected-packages` adds rows and references for `@effected/engine` and `@effected/mcp`, updates the `@effected/cli` and `@effected/workspaces` rows for their new testing subpaths, and counts 34 packages.
- `effect-v4-testing` routes front-end and repo-shape testing to its owner, and adds guidance on dead timeouts, unobserved forks and real-clock suites.
- The `effect-developer` and `effect-reviewer` agents route front-end work to `effect-v4-cli`, `effect-v4-mcp` or `design-patterns`.

## Bug Fixes

- Skills and agents now state current Effect behaviour without prerelease version numbers or history, which went stale as the kit's Effect pin moved.
- Corrected the vitest verification guidance: read both the `Tests:` line and the exit code, since a run that collects nothing prints `Tests: 0/0 passed` and exits 1.
