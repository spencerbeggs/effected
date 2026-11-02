---
id: "0048"
title: The CLI, MCP and engine libraries are renamed to cli-kit, mcp-kit and kit
kind: breaking
shows: typed
applies:
  "@effected/pnpm-plugin-effected": ">=0.21.0"
detect: ["@effected/(cli|mcp|engine)([\"'/]|$)"]
changesets:
  - rename-carrier-libraries
  - effected-cli-tool
  - effected-mcp-tool
  - effected-engine-tool
---

Three kit libraries were renamed, with no compatibility shim: `@effected/cli` is now `@effected/cli-kit`, `@effected/mcp` is now `@effected/mcp-kit`, and `@effected/engine` is now `@effected/kit`. Subpaths carry over unchanged: `@effected/cli/ui` becomes `@effected/cli-kit/ui`, `@effected/cli/testing` becomes `@effected/cli-kit/testing`, and so on.

The freed names now belong to the `effected` tool's own packages (`@effected/cli`, `@effected/mcp`, `@effected/engine`), which are in the `effected` catalog too. So a stale reference does not fail the install: it resolves to the tool package, and the break shows only at build, as missing exports or missing subpaths.

What to change:

- **Imports.** Rewrite every import and `import type` from the old names to the new ones, subpaths included.
- **Manifests.** Rename the dependency in `dependencies`, `devDependencies` and `peerDependencies`. A line such as `"@effected/cli": "catalog:effected"` now installs the tool package, so the catalog reference must be renamed along with the name: `"@effected/cli-kit": "catalog:effected"`.
- **Config and docs.** Rename the old names in `tsconfig` paths, bundler externals, `knip` or lint ignore lists and any prose that tells a reader which package to install.
- **A lockfile that still lists the old names** is stale: reinstall after the rename and check that the old names resolve to nothing you import.

Check the installed `.d.ts` of the renamed package rather than guessing: the exports are the same, but the entry points you import from must exist under the new name. A compiler error naming a missing export from `@effected/cli`, `@effected/mcp` or `@effected/engine` means a rename was missed.
