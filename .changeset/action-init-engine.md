---
"@effected/engine": minor
---

## Features

### Scaffold a GitHub Action

`effected action init` and the `action_init` MCP tool scaffold a new GitHub Action in a package directory: the `[action]` table of `effected.toml`, `action.yml`, `src/main.ts`, `src/program.ts` and `tsconfig.json`, ready for `effected action build`.

* It refuses, writing nothing, when any of those files exists, unless `--force` is given. `--force` never overrides a conflict
* It always refuses a symbolic link, a case variant of a target name, or a write outside the package directory
* It edits no `package.json`: it reports the missing dependencies to add instead
* The command exits 0 on success, 2 on a refusal and 3 when the run cannot finish
