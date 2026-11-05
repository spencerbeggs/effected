---
id: "0001"
title: "The schemastore bin and @effected/schemastore-cli are replaced by effected schema"
kind: tooling
shows: behavioural
applies:
  "@effected/schemastore": ">=0.30.0"
detect: ["schemastore (build|check|validate)", "\"@effected/schemastore-cli\"", "defineConfig.*from \"@effected/schemastore\""]
changesets: ["brave-lines-diff", "calm-paths-contain", "define-schema-config", "quiet-help-streams", "schema-command-arrives", "schema-runner-lands", "stamped-schemas-agree", "teach-effected-schema", "tidy-server-meta", "tools-learn-schema"]
---

The standalone `@effected/schemastore-cli` package and its `schemastore` bin are gone. The same pipeline now runs as `effected schema build|check|validate`, and the `effected` MCP server exposes it as the `schema_build`, `schema_check` and `schema_validate` tools. The flags and exit codes are unchanged. Do these in one step.

1. **Move the packages together.** Bump `@effected/schemastore` and add the tool in the same install. The old CLI peered on an exact `@effected/schemastore` version, so moving one without the other cannot resolve.
2. **Swap the dependency.** Add `@effected/plugin` through `catalog:effected` as a root devDependency, and delete `@effected/schemastore-cli`. While its catalog reference remains, install fails, because the catalog no longer names it.
3. **Rename the scripts and workflow steps.** `schemastore build <config>` becomes `effected schema build <config>`; do the same for `check` and `validate`. Look in `package.json` scripts, CI workflows, turbo tasks and prose that quotes the command.
4. **Change the config import.** In each `schemastore.config.*`, write `import { defineSchemastore } from "@effected/plugin"` and call `defineSchemastore(...)` where the file called `defineConfig(...)`. A repository that installs only `@effected/mcp` and not `@effected/plugin` keeps `defineConfig` from `@effected/schemastore`.
5. **Fix ajv imports.** The ajv-backed validators moved to the `@effected/engine/schema` subpath. Re-point any import of them from the old CLI package, and add `@effected/engine` to the repository's own dependencies: it was transitive through the old CLI, and `@effected/plugin` does not expose it.

Two behaviours are new. Check them against your own run rather than assuming:

- The tool and `@effected/schemastore` must agree on a version. A mismatch fails `effected schema` at exit 2 and names both versions. Pass `--ignore-version-mismatch` to override it. The MCP `schema_*` tools run under a mismatch and add a warning.
- A long-lived MCP server does not see edits to `.mjs`, `.cjs` or `.js` files under `"type": "module"`, or to a built sibling package. Restart the server after changing one.

Verify with `effected schema check` on your config and read the installed `.d.ts` for `defineSchemastore` before relying on its shape.
