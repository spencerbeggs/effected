---
id: "0002"
title: "GitHub Actions build with effected action build and [action] tables instead of @savvy-web/github-action-builder"
kind: tooling
shows: behavioural
applies:
  "@effected/plugin": ">=0.3.0"
detect: ["\"@savvy-web/github-action-builder\"", "github-action-builder (build|validate)", "action\\.config\\.ts", "nativeDynamicImports"]
changesets: ["bright-tools-build", "calm-bundles-build", "keen-builds-land", "proud-presets-ship", "quick-agents-build", "action-init-engine", "action-init-cli", "action-init-mcp"]
---

`effected action build` replaces `github-action-builder build`, and `[action]` tables in `effected.toml` replace `action.config.ts` and its `defineConfig`. An action's output does not move: `dist/main.js` and its siblings stay where they were, so `runs.main`, `runs.pre` and `runs.post` in `action.yml` need no edit.

1. **Swap the dependency.** Delete `@savvy-web/github-action-builder` and make sure `@effected/plugin` is a root devDependency through `catalog:effected`.
2. **Rename the scripts.** `github-action-builder build` becomes `effected action build`. Look in `package.json` scripts, turbo tasks, CI workflows and prose that quotes the command. There is no standalone `validate` command: validation runs inside the build, and `--no-validate` skips it. Delete or repoint a `github-action-builder validate` script.
3. **Move the config.** Delete `action.config.ts`. An absent `[action]` table means the directory is not an action and the command refuses it, so write the table even when it is empty.
   - `entries` becomes `[action.entries]`, with `workers` as `[action.entries.workers]`.
   - `build` becomes `[action.build]`. `ignore` and `externals` keep their meaning.
   - `persistLocal` becomes `[action.persistLocal]`, and `effected action build` honours it as `github-action-builder build` did. The MCP tool `action_build` differs: it persists only when called with `persist: true`.
4. **Delete `nativeDynamicImports`.** It has no counterpart, and writing it fails as an unknown key. Rolldown keeps a computed `import()` native, so an import whose specifier is an expression now works without it. A literal `import("pkg")` is not computed and gets bundled; to keep one out of the bundle, list it in `externals`. Run the action down that path to check it.
5. **Check the load check.** After bundling, `importCheck` imports every bundle in a fresh Node inside a temporary directory, with only `HOME` and `TMPDIR` set: no `PATH`, no token and no `GITHUB_*` variable. An action that spawns a command at import time fails there, so set `[action.build] importCheck = false` for it. An action with no `GITHUB_ACTIONS` guard around its program runs for real during the check.

A new action starts from `effected action init` (MCP: `action_init`), which writes the `[action]` table, `action.yml`, the entry, the program and the tsconfig, refuses to overwrite or to write through a symlink, and lists the dependencies still to add. It is for a fresh repository; never run it over an existing action.

Verify by running `effected action build`, then the action once in CI. Read the installed `.d.ts` for `@effected/bundler`'s `ActionConfig` for the exact shape of a key.
