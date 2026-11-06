---
"@effected/cli": minor
---

## Features

* Adds `effected package build`, which builds the current package from its `effected.toml`; `--no-exe` skips the single-executable compile and `--verbose` measures gzip sizes for the report
* Adds `effected action build`, which builds a GitHub Action; `--no-validate` skips validation and `--no-persist` skips copying the build to the local action directory
* `effected action build` persists to the local action directory by default (`--no-persist` turns it off), while the MCP `action_build` tool persists only with `persist: true`
* Both commands take `--format` like `effected schema`, and report through the exit code: 0 the build succeeded, 1 the build or its validation failed, 2 the config, a plugin or the directory is at fault (not a package, or not an action), 3 the run could not finish, 64 a usage error

## Breaking Changes

* `typescript` (`7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`) and `@types/node` are now peer dependencies, because the build runs the TypeScript compiler. A consumer without them installed gets a peer warning
