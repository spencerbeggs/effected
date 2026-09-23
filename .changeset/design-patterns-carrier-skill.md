---
"@effected/claude-code-plugin": minor
---

## Features

- New `design-patterns` skill: an index of proven architecture patterns for building on Effect v4 and the `@effected` kit, with each pattern kept in its own loadable references. The first pattern is the carrier package: shared core, engine and front-end packages (CLI, MCP, LSP) delivered to consumers through one carrier package.
- Covers the direct-dependency bin-linking problem the pattern solves, the rule for `dependencies` versus peers, and the `bin.ts` / `main.ts` / `index.ts` entry contract with mirror bin shims.
- Covers threading versions through the components with a `Distribution` `Context.Reference` and `engine_version`, plus plugin loaders that run the project's own `node_modules/.bin` first and fall back to a major-pinned `npx`.
- Covers verification: a manifest DAG test with positive controls, source boundary tests, and a packed-install e2e test.
- Adds an optional reference on placing the app layer and config schemas: core owns the shape, its version and its hosted schema identity; the engine owns platform and config discovery.
- Case studies from okfit, vitest-agent and Silk, cited by public GitHub URL.
- `effect-developer` and `effect-reviewer` preload the skill.
