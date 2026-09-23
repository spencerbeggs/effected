---
"@effected/claude-code-plugin": minor
---

## Features

### `design-patterns` skill

- New `design-patterns` skill: an index of proven architecture patterns for building on Effect v4 and the `@effected` kit, with each pattern kept in its own loadable references. The first pattern is the carrier package: shared core, engine and front-end packages (CLI, MCP, LSP) delivered to consumers through one carrier package.
- Covers the direct-dependency bin-linking problem the pattern solves, the rule for `dependencies` versus peers, and the `bin.ts` / `main.ts` / `index.ts` entry contract with mirror bin shims.
- Covers threading versions through the components with a `Distribution` `Context.Reference` and `engine_version`, plus plugin loaders that run the project's own `node_modules/.bin` first and fall back to a major-pinned `npx`.
- Covers verification: a manifest DAG test with positive controls, source boundary tests, and a packed-install e2e test.
- Adds an optional reference on placing the app layer and config schemas: core owns the shape, its version and its hosted schema identity; the engine owns platform and config discovery.
- Case studies from okfit, vitest-agent and Silk, cited by public GitHub URL.
- `effect-developer` and `effect-reviewer` preload the skill.

### `effected-packages` index

- Adds a row and a per-package reference for the new `@effected/engine` package: platform-free primitives (`Distribution`, `Remediation`, `LaunchContext`) shared across a tool's front ends.
- Updates the `@effected/cli` row and reference for the package's new `CliExit`, `CliColor`, `CliRuntime.main` and `@effected/cli/testing` surface, and the `CliLogger` default flip to `stderrFrom: "All"`.
- Package count corrected from 32 to 33.

### `effect-v4-cli` skill

- Corrects the documented `CliLogger.layer()` default: `stderrFrom` now defaults to `"All"` (every level to stderr), not `"Error"`. Also notes that `Command.runWith` renders a `CliError.UserError` itself, so `CliRuntime.reportFailures`/`main` skip re-printing it and exit with the usage code.
