---
"@effected/kit": minor
"@effected/cli-kit": minor
"@effected/mcp-kit": minor
"@effected/schemastore-cli": patch
"@effected/workspaces": patch
"@effected/app": patch
"@effected/env": patch
"@effected/github-actions": patch
"@effected/github-commands": patch
"@effected/lsp": patch
"@effected/pnpm-plugin-effected": patch
---

## Breaking Changes

* The three carrier libraries are renamed so the `@effected/cli`, `@effected/mcp` and `@effected/engine` names are free for the `effected` tool's own packages. Rename every import and dependency; there is no compatibility shim, and every subpath (`./ui`, `./testing`, `./guard`, `./node`) carries over unchanged.

| Old name            | New name            |
| :------------------ | :------------------ |
| `@effected/engine`  | `@effected/kit`     |
| `@effected/cli`     | `@effected/cli-kit` |
| `@effected/mcp`     | `@effected/mcp-kit` |

## Refactoring

* Dependents rename their imports and dependency declarations to the new package names. The `effected` catalog lists the renamed packages under their new names.
